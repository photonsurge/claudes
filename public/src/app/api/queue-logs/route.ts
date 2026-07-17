/**
 * /api/queue-logs — pull the worker's retained per-job console output.
 *
 *   GET /api/queue-logs                 → index of jobs that have logs
 *   GET /api/queue-logs?jobId=1784…     → that job's log lines
 *
 * Two ways in (either is sufficient):
 *   - an admin session cookie (so the /admin/queue card can backfill on expand
 *     with the operator's existing login — no key in the browser), or
 *   - `?key=` / `x-queue-log-key` / `Authorization: Bearer <key>` matching the
 *     QUEUE_LOG_KEY env var, for curl / tooling from the server.
 *
 * This route sits OUTSIDE the /api/admin/* matcher, so proxy.ts doesn't force a
 * session — it self-guards here instead, which is what lets a keyed curl through.
 * If QUEUE_LOG_KEY is unset, only the session path works (no anonymous access).
 *
 * The lines themselves come from the worker's internal ring (internal-only, so
 * unreachable from the browser directly); we proxy over the compose `internal`
 * network. Fail-soft: `{ lines: [] }` / `{ jobs: [] }` with 200 on worker error.
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import { withApiLog } from "../../../lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_URL = process.env.WORKER_INTERNAL_URL || "http://localhost:10102";
const TIMEOUT_MS = Number(process.env.WORKER_STATS_TIMEOUT_MS || 4000);

async function hasSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isAdmin(token ? readSession(token) : null);
}

async function hasKey(req: Request): Promise<boolean> {
  const expected = process.env.QUEUE_LOG_KEY;
  if (!expected) return false; // no key configured → key path disabled
  const h = await headers();
  const bearer = h.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = new URL(req.url).searchParams.get("key") || h.get("x-queue-log-key") || bearer || "";
  return provided.length > 0 && provided === expected;
}

async function proxyGet(path: string): Promise<unknown> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`worker → ${res.status}`);
  return res.json();
}

async function GET__impl(req: Request) {
  if (!(await hasSession()) && !(await hasKey(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(req.url).searchParams.get("jobId");
  try {
    if (jobId) {
      const body = await proxyGet(`/internal/job-log/${encodeURIComponent(jobId)}`);
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }
    const body = await proxyGet(`/internal/job-logs`);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const empty = jobId ? { jobId, lines: [] } : { jobs: [] };
    return NextResponse.json({ ...empty, error: err?.message || String(err) }, { headers: { "Cache-Control": "no-store" } });
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
