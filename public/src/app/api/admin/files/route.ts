import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { BLOB_NAMESPACES, getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/files — what the shared `${BLOB_DIR}` folder actually holds:
 * files and bytes per namespace, leftover temp writes, and how much room is
 * left on the disk underneath. The filesystem-side sibling of /api/admin/db
 * (which measures Mongo), since the bytes now live in a plain folder that
 * nothing else keeps count of.
 *
 * The walk is a stat per blob, so this is deliberately on-demand and uncached —
 * an operator asking "what is eating the disk" wants the live number, and the
 * page is behind admin auth.
 */
async function GET__impl() {
  const db = await getAppDb();
  if (!db.blobFs) {
    // BLOB_DIR unset (local dev without the shared folder) — bytes are still in
    // Mongo, so there is nothing on disk to measure. Not an error.
    return NextResponse.json({ enabled: false, at: new Date().toISOString() }, { status: 200, headers: NO_CACHE });
  }

  const started = Date.now();
  let usage;
  try {
    usage = await db.blobFs.usage();
  } catch (err: any) {
    // Most likely the bind-mount ownership trap: the containers run as 1001 but
    // Docker creates the host folder root:root. Say so rather than "EACCES".
    const detail = err?.code === "EACCES" || err?.code === "EPERM"
      ? `${db.blobFs.root} is not readable by this process (${err.code}) — check the blob folder's ownership.`
      : err?.message || String(err);
    return NextResponse.json({ error: detail }, { status: 500, headers: NO_CACHE });
  }

  const namespaces = usage.namespaces.map((n) => ({
    ...n,
    label: BLOB_NAMESPACES[n.ns]?.label ?? n.ns,
    desc: BLOB_NAMESPACES[n.ns]?.desc ?? "Not written by any current store — may be reclaimable.",
    known: n.ns in BLOB_NAMESPACES,
  }));

  return NextResponse.json(
    {
      enabled: true,
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
      tookMs: Date.now() - started,
      at: new Date().toISOString(),
    },
    { status: 200, headers: NO_CACHE },
  );
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
