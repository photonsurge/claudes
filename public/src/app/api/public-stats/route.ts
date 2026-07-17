/**
 * /api/public-stats — THIS public app's own memory split (rss vs JS heap vs
 * native gap), the counterpart of /api/admin/worker-stats for the process that
 * serves the site itself. Answers "is public's flat 1.2GB a leak or a native
 * plateau?" from anywhere, not just a box-local curl.
 *
 * Two ways in (either is sufficient — mirrors /api/queue-logs exactly):
 *   - an admin session cookie (the /admin/queue memory card path), or
 *   - `?key=` / `x-queue-log-key` / `Authorization: Bearer <key>` matching the
 *     QUEUE_LOG_KEY env var, for curl / tooling.
 *
 * Sits OUTSIDE the /api/admin/* matcher so the keyed path works without a
 * session; self-guards here. If QUEUE_LOG_KEY is unset, only the session path
 * works — never anonymous.
 */
import v8 from "v8";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
import { withApiLog } from "../../../lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function GET__impl(req: Request) {
  if (!(await hasSession()) && !(await hasKey(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mb = (b: number) => Math.round(b / 1048576);
  const m = process.memoryUsage();
  return NextResponse.json(
    {
      status: "ok",
      rssMB: mb(m.rss),
      heapUsedMB: mb(m.heapUsed),
      heapTotalMB: mb(m.heapTotal),
      /** V8 old-space ceiling (NODE_OPTIONS --max-old-space-size). */
      heapLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
      externalMB: mb(m.external),
      arrayBuffersMB: mb(m.arrayBuffers),
      /** rss minus everything V8 accounts for ≈ native (sharp/glibc arenas). */
      nativeGapMB: mb(m.rss - m.heapTotal - m.external),
      uptimeSec: Math.round(process.uptime()),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
