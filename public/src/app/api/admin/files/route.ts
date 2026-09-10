import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { BLOB_NAMESPACES, getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Past this age the page says so, so nobody reads a stale number as live. */
const STALE_AFTER_MS = Number(process.env.BLOB_USAGE_STALE_MS || 3 * 60 * 60 * 1000);

/**
 * GET /api/admin/files — what the shared `${BLOB_DIR}` folder holds: files and
 * bytes per namespace, leftover temp writes, and disk free underneath.
 *
 * This route used to do the measuring itself, and that stopped working. The walk
 * is a `stat` per blob across the whole tree; once the tree was hundreds of
 * thousands of files it outlived the reverse proxy's read timeout, and the page
 * got the proxy's HTML error page back and choked trying to parse it as JSON. So
 * the page that exists to diagnose disk usage was the one thing disk usage broke.
 *
 * The walk now lives in the worker (`maintenance.measureBlobs`, hourly and at
 * boot) and this route reads one small cached document. Instant, and it can no
 * longer be killed by the size of the thing it is reporting on. `Refresh` on the
 * page enqueues a fresh measurement rather than blocking on one.
 */
async function GET__impl() {
  const db = await getAppDb();
  if (!db.blobFs) {
    // BLOB_DIR unset (local dev without the shared folder) — bytes are still in
    // Mongo, so there is nothing on disk to measure. Not an error.
    return NextResponse.json({ enabled: false, at: new Date().toISOString() }, { status: 200, headers: NO_CACHE });
  }

  const snapshot = await db.blobUsage.get();
  if (!snapshot) {
    // The worker has not measured yet (fresh deploy, or the job is mid-flight).
    // A 200 with `pending` beats an error: nothing is wrong, the answer is just
    // not in yet, and the page can say so and offer to trigger one.
    return NextResponse.json(
      {
        enabled: true,
        pending: true,
        root: db.blobFs.root,
        at: new Date().toISOString(),
      },
      { status: 200, headers: NO_CACHE },
    );
  }

  const { usage, measuredAt, tookMs } = snapshot;
  const ageMs = Date.now() - +new Date(measuredAt);

  const namespaces = usage.namespaces.map((n) => ({
    ...n,
    label: BLOB_NAMESPACES[n.ns]?.label ?? n.ns,
    desc: BLOB_NAMESPACES[n.ns]?.desc ?? "Not written by any current store — may be reclaimable.",
    known: n.ns in BLOB_NAMESPACES,
  }));

  return NextResponse.json(
    {
      enabled: true,
      pending: false,
      root: usage.root,
      files: usage.files,
      bytes: usage.bytes,
      tmpFiles: usage.tmpFiles,
      tmpBytes: usage.tmpBytes,
      disk: usage.disk,
      namespaces,
      // Namespaces the registry declares that have no directory yet — nothing
      // has ever been written for them. Worth showing so an empty overlay reads
      // as "never baked" instead of vanishing from the page.
      emptyNamespaces: Object.keys(BLOB_NAMESPACES).filter((ns) => !usage.namespaces.some((n) => n.ns === ns)),
      measuredAt,
      ageMs,
      stale: ageMs > STALE_AFTER_MS,
      tookMs,
      at: new Date().toISOString(),
    },
    { status: 200, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
