/**
 * /api/status — aggregates version + up/down for every service in the stack
 * (this public app, socket, worker, mongodb, redis) for the Home/Admin status
 * panels. Socket + worker are reached over the docker-compose `internal`
 * network (SOCKET_INTERNAL_URL / WORKER_INTERNAL_URL, defaulting to the local
 * dev ports); mongo/redis are checked via the same connections shared already
 * maintains, so this adds no new connections.
 */
import { NextResponse } from "next/server";
import { getDb } from "@photonsurge/shared/utill/mongoose";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { withCache } from "../../../lib/focus/focus-cache";
import packageJson from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 3000;
/** Every /watch tab + status panel polls this, and it fans out to socket +
 *  worker + mongo + redis — so cache the aggregate briefly: N concurrent pollers
 *  dedup to ONE fan-out per window instead of each hitting all four services. */
const STATUS_TTL_SEC = Number(process.env.STATUS_CACHE_TTL_SEC || 10);

interface ServiceStatus {
  name: string;
  version: string | null;
  status: "ok" | "down";
  detail?: string;
}

async function httpService(name: string, base: string): Promise<ServiceStatus> {
  try {
    const [health, version] = await Promise.all([
      fetch(`${base}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${base}/version`, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((r) => r.json()),
    ]);
    return { name, version: version?.version ?? null, status: health.ok ? "ok" : "down" };
  } catch (err: any) {
    return { name, version: null, status: "down", detail: err?.message || String(err) };
  }
}

async function mongoStatus(): Promise<ServiceStatus> {
  try {
    const conn = await getDb();
    const admin = conn.db!.admin();
    const [, info] = await Promise.all([admin.ping(), admin.buildInfo()]);
    return { name: "mongodb", version: info?.version ?? null, status: "ok" };
  } catch (err: any) {
    return { name: "mongodb", version: null, status: "down", detail: err?.message || String(err) };
  }
}

async function redisStatus(): Promise<ServiceStatus> {
  try {
    const client = await getQueue().client;
    const [pong, info] = await Promise.all([client.ping(), client.info("server")]);
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? null;
    return { name: "redis", version, status: pong === "PONG" ? "ok" : "down" };
  } catch (err: any) {
    return { name: "redis", version: null, status: "down", detail: err?.message || String(err) };
  }
}

export async function GET() {
  const { value } = await withCache("status:v1", STATUS_TTL_SEC, async () => {
    const SOCKET_URL = process.env.SOCKET_INTERNAL_URL || "http://localhost:10101";
    const WORKER_URL = process.env.WORKER_INTERNAL_URL || "http://localhost:10102";

    const [socket, worker, mongodb, redis] = await Promise.all([
      httpService("socket", SOCKET_URL),
      httpService("worker", WORKER_URL),
      mongoStatus(),
      redisStatus(),
    ]);

    const services: ServiceStatus[] = [
      { name: "public", version: packageJson.version, status: "ok" },
      socket,
      worker,
      mongodb,
      redis,
    ];
    return { services, time: new Date().toISOString() };
  });

  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}
