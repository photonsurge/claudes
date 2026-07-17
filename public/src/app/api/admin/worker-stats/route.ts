/**
 * /api/admin/worker-stats — server-side proxy to the worker's internal /status.
 *
 * The worker's /status is internal-only (it rejects any request that arrived via
 * a proxy — see the x-forwarded guard there), so the browser can't hit it. This
 * route reaches it over the compose `internal` network (WORKER_INTERNAL_URL) and
 * hands the JSON straight through for the /admin/health dashboard: queue tiers +
 * their concurrency, the rss/heap memory snapshot, and the per-event usage ledger.
 *
 * Fail-soft: if the worker is unreachable we return `{ status: "down", error }`
 * with 200 so the page can render an "offline" state rather than throwing.
 */
import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_URL = process.env.WORKER_INTERNAL_URL || "http://localhost:10102";
const TIMEOUT_MS = Number(process.env.WORKER_STATS_TIMEOUT_MS || 4000);

async function GET__impl(_req: Request) {
  try {
    const res = await fetch(`${WORKER_URL}/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json(
        { status: "down", error: `worker /status → ${res.status}` },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = await res.json();
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json(
      { status: "down", error: err?.message || String(err) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
