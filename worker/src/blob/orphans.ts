// blob/orphans.ts
// Find (and optionally delete) blobs on disk that no metadata doc references.
//
// Every read path goes doc -> `blobs.get(doc.id)`, so a blob whose doc is gone is
// completely invisible: it never appears in a listing, never gets served, and
// nothing will ever delete it. A prune that dies between the two writes, an
// interrupted migration, or a collection dropped by hand all leave bytes behind
// permanently. There was no sweeper at all (docs/blob-retention-plan.md).
//
// Deliberately REPORT-FIRST. `runOrphanSweep` counts; deleting requires
// `apply: true`, which the admin surface exposes as a separate button.
//
// A namespace with no metadata collection to compare against (basemap: a bare
// key->bytes store keyed by texture name) is reported as UNSWEPT rather than
// guessed at - an unknown key there is a live basemap, not garbage.

import type { Model } from "mongoose";
import { log } from "@photonsurge/shared/utill/logger";

/** How a namespace's live key set is discovered. */
export interface NamespaceOwner {
  ns: string;
  label: string;
  model: Model<any>;
  /** The doc field whose value is the blob key. */
  keyField: string;
}

/** Namespaces intentionally not swept, and why. */
export const UNSWEPT_NAMESPACES: Record<string, string> = {
  basemap:
    "no metadata collection - keys are texture names written straight by the basemap job, so an unrecognised key is a live basemap, not an orphan",
};

/** Build the owner list from a live db handle. Kept here so it tracks createDb. */
export function namespaceOwners(db: any): NamespaceOwner[] {
  return [
    { ns: "tex", label: "WeatherTexture", model: db.weatherTextures.model, keyField: "id" },
    { ns: "frame", label: "WeatherFrame", model: db.weatherFrames.model, keyField: "id" },
    { ns: "forecast-frame", label: "WeatherForecastFrame", model: db.weatherForecastFrames.model, keyField: "id" },
    { ns: "admin-image", label: "AdminImage", model: db.adminImages.model, keyField: "id" },
    { ns: "ad", label: "Ad", model: db.ads.model, keyField: "adId" },
    { ns: "aurora", label: "Aurora", model: db.aurora.auroraModel, keyField: "id" },
    { ns: "geomag", label: "Geomag", model: db.geomag.geomagModel, keyField: "id" },
    { ns: "satimg", label: "SatImg", model: db.satimg.satImgModel, keyField: "satId" },
    { ns: "alert-snapshot", label: "AlertSnapshot", model: db.alertSnapshots.model, keyField: "id" },
    { ns: "event-snapshot", label: "EventSnapshot", model: db.eventSnapshots.model, keyField: "id" },
    { ns: "volcano-media", label: "VolcanoMedia", model: db.volcanoMedia.model, keyField: "id" },
  ];
}

export interface OrphanNamespaceResult {
  ns: string;
  label: string;
  /** Blobs on disk. */
  files: number;
  /** Keys the metadata collection still references. */
  referenced: number;
  orphans: number;
  orphanBytes: number;
  deleted: number;
  /** Set when the namespace was skipped rather than swept. */
  skipped?: string;
}

export interface OrphanSweepResult {
  apply: boolean;
  namespaces: OrphanNamespaceResult[];
  orphans: number;
  orphanBytes: number;
  deleted: number;
}

/** Never delete a blob written in the last few minutes - it may be mid-write. */
const GRACE_MS = Number(process.env.BLOB_ORPHAN_GRACE_MS || 15 * 60 * 1000);

/**
 * Compare each namespace's on-disk keys against the keys its metadata collection
 * still references. Reports by default; pass `apply: true` to delete.
 */
export async function runOrphanSweep(
  db: any,
  opts: { apply?: boolean; now?: number } = {},
): Promise<OrphanSweepResult> {
  const apply = opts.apply === true;
  const now = opts.now ?? Date.now();
  const fs = db.blobFs;
  if (!fs) {
    log("blob:orphans", "BLOB_DIR not set - nothing on disk to sweep");
    return { apply, namespaces: [], orphans: 0, orphanBytes: 0, deleted: 0 };
  }

  const owners = namespaceOwners(db);
  const byNs = new Map(owners.map((o) => [o.ns, o]));
  const present = await fs.listNamespaces();
  const results: OrphanNamespaceResult[] = [];

  for (const ns of present) {
    const owner = byNs.get(ns);
    const entries: { key: string; bytes: number; mtimeMs: number }[] = await fs.listKeys(ns);

    if (!owner) {
      results.push({
        ns,
        label: ns,
        files: entries.length,
        referenced: 0,
        orphans: 0,
        orphanBytes: 0,
        deleted: 0,
        skipped:
          UNSWEPT_NAMESPACES[ns] ??
          "no owning collection is registered for this namespace - left alone rather than guessed at",
      });
      continue;
    }

    const referenced: string[] = await owner.model.distinct(owner.keyField).exec();
    const live = new Set(referenced.map(String));
    // A blob written seconds ago may belong to a doc that is still being written.
    const orphans = entries.filter((e) => !live.has(e.key) && now - e.mtimeMs > GRACE_MS);
    const orphanBytes = orphans.reduce((sum, e) => sum + e.bytes, 0);

    let deleted = 0;
    if (apply && orphans.length) {
      const keys = orphans.map((e) => e.key);
      for (let i = 0; i < keys.length; i += 500) {
        await fs.delete(ns, keys.slice(i, i + 500));
      }
      deleted = keys.length;
    }

    results.push({
      ns,
      label: owner.label,
      files: entries.length,
      referenced: live.size,
      orphans: orphans.length,
      orphanBytes,
      deleted,
    });
  }

  const result: OrphanSweepResult = {
    apply,
    namespaces: results,
    orphans: results.reduce((s, r) => s + r.orphans, 0),
    orphanBytes: results.reduce((s, r) => s + r.orphanBytes, 0),
    deleted: results.reduce((s, r) => s + r.deleted, 0),
  };
  log("blob:orphans", apply ? "orphan sweep applied" : "orphan sweep REPORT", {
    orphans: result.orphans,
    mb: Math.round(result.orphanBytes / 1048576),
    deleted: result.deleted,
  });
  return result;
}
