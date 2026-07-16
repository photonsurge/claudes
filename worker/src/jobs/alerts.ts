import type { Job } from "bullmq";
import sharp from "sharp";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { getEnabledSources, getSource } from "../alerts/registry";
import { ingestSource, type IngestResult } from "../alerts/ingest";
import { selectSnapshotTargets, hourSlotOf } from "../alerts/snapshot-select";
import { fetchSatelliteFrame } from "../satimg/frame";
import { sideBySide } from "../satimg/compare";
import { pHash, hamming } from "../satimg/phash";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { ALERTS_UPDATED } from "@photonsurge/shared/control";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";
import { emitWorkerEvent } from "../socket";

export { translate } from "../alerts/translate";

const TAG = "job:alerts";

/** Satellite-snapshot config (env-tunable). Opt-out via ALERT_SNAPSHOT_ENABLED=false. */
export const alertSnapshotEnabled = () => process.env.ALERT_SNAPSHOT_ENABLED !== "false";
/** Camera stills are opt-IN (they fetch + store third-party images). */
export const cameraSnapshotsEnabled = () => process.env.ALERT_CAMERA_SNAPSHOT_ENABLED === "true";
const SNAP_MIN_SEV = Number(process.env.ALERT_SNAPSHOT_MIN_SEV || 3);
const SNAP_MAX = Number(process.env.ALERT_SNAPSHOT_MAX || 50);
const SNAP_MAX_PX = Number(process.env.ALERT_SNAPSHOT_PX || 1024);
/** BSON safety for the inline-fallback path (bytes normally live on disk). */
const SNAP_MAX_BYTES = 15_500_000;
const CAM_RADIUS_KM = Number(process.env.ALERT_CAMERA_RADIUS_KM || 300);
const CAM_LIMIT = Number(process.env.ALERT_CAMERA_LIMIT || 3);
/** Below this dHash distance, a camera still is "the same picture" → skip storing. */
const PHASH_THRESHOLD = Number(process.env.ALERT_CAMERA_PHASH_THRESHOLD || 4);

/** "12 Jul 15:00 UTC"-style label for a snapshot comparison caption. */
const capLabel = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Dispatched as type "alerts", event "ingest". With `data.source` set, ingests
 * just that source (one repeatable job per source — see index.ts); with no
 * source, ingests every enabled source. Each source is wrapped independently so
 * one failing/ratelimited feed never blocks the others (spec §6).
 */
export async function ingest(job: Job) {
  const id: string | undefined = job.data?.data?.source;
  const sources = id ? [getSource(id)].filter(Boolean) : getEnabledSources();

  const db = await getAppDb();
  const results: (IngestResult | { source: string; error: string })[] = [];

  for (const source of sources) {
    if (!source) continue;
    try {
      const r = await ingestSource(source, db);
      results.push(r);
      blogInfo(TAG, `${source.id}: ${r.count} alerts (+${r.inserted} new)`, r, "alerts", source.id);
    } catch (err) {
      log(TAG, `source failed`, { source: source.id, err: summarizeForLog(err) });
      blogErr(TAG, `${source.id} ingest failed`, err, "alerts", source.id);
      results.push({ source: source.id, error: String(err) });
    }
  }

  // Retire the greens already stored. The parse drops them on the way in now, but
  // MeteoAlarm doesn't reconcile (fan-out feed, transient gaps), so nothing else
  // would ever take the existing ones off the globe. Idempotent — see the repo.
  const greens = await db.alerts.deactivateMeteoalarmGreens();
  if (greens.deactivated) log(TAG, `retired green meteoalarm alerts (nothing expected)`, greens);

  // Re-rank stored MeteoAlarm alerts from their own awareness level. Ingest only
  // ranks alerts it WRITES, and its fast path skips an unchanged active alert —
  // so a change to the rank rule reaches new alerts and nothing else. Runs every
  // tick because it's self-healing and idempotent: steady state scans a
  // geometry-free projection and writes nothing. See resyncMeteoalarmRanks.
  const reranked = await db.alerts.resyncMeteoalarmRanks();
  if (reranked.changed) log(TAG, `re-ranked stored meteoalarm alerts`, reranked);

  // Live push: tell browsers to refetch the overlay/list the instant ingest
  // finishes, instead of waiting out their 60s poll (mirrors TRACKS_UPDATED).
  const changed = results.reduce((n, r) => n + ("inserted" in r ? r.inserted + (r.expired ?? 0) : 0), 0);
  emitWorkerEvent({ type: ALERTS_UPDATED, data: { sources: results.length, changed } });

  // Onset snapshot: an alert that just escalated to severe+ gets an immediate
  // low-priority satellite frame, so it has imagery the moment it matters rather
  // than waiting out the hourly sweep. (ingestSource surfaces the ids.)
  if (alertSnapshotEnabled()) {
    const onset = new Set<string>();
    for (const r of results) {
      if ("newlyInteresting" in r) for (const id of r.newlyInteresting ?? []) onset.add(id);
    }
    for (const id of onset) {
      try {
        await sendToQueue("alerts", "alerts", "snapshotSatellite", { alertId: id }, undefined, QUEUE_PRIORITY.LOW);
      } catch (err) {
        log(TAG, `enqueue onset snapshot failed`, { id, err: String(err) });
      }
    }
  }

  log(TAG, `done`, { jobId: job.id, sources: results.length });
  return { results };
}

/**
 * Capture a GIBS satellite still over the bbox of interesting active alerts
 * (severe+, with drawable geometry, capped). Dispatched as type "alerts", event
 * "snapshotSatellite": with `data.alertId` it snapshots just that alert (the
 * onset one-shot enqueued when an alert escalates); with none it sweeps the
 * current interesting set (the hourly repeatable). Frames dedup per hour slot, so
 * a re-run within the hour replaces rather than duplicates. Uses the reusable
 * `fetchSatelliteFrame` (feature-agnostic — volcanoes/events can reuse it).
 */
export async function snapshotSatellite(job: Job) {
  if (!alertSnapshotEnabled()) {
    log(TAG, `snapshotSatellite skipped (ALERT_SNAPSHOT_ENABLED=false)`);
    return { skipped: true };
  }
  const db = await getAppDb();
  const alertId: string | undefined = job.data?.data?.alertId;
  try {
    const alerts = alertId
      ? [await db.alerts.getById(alertId)].filter((a): a is NonNullable<typeof a> => !!a)
      : await db.alerts.list({ activeOnly: true, severityMin: SNAP_MIN_SEV });
    const targets = selectSnapshotTargets(alerts, { max: alertId ? 1 : SNAP_MAX });
    const hourSlot = hourSlotOf(new Date());

    let stored = 0;
    let empty = 0;
    let tooBig = 0;
    let unchanged = 0;
    // `selectSnapshotTargets` already dropped the hazards satellite can't show and resolved
    // each survivor's view (heat → land-surface temperature, else true-colour).
    for (const { alert, bbox, view } of targets) {
      let frame = await fetchSatelliteFrame(bbox, { view, maxPx: SNAP_MAX_PX });
      // LST is land-only + cloud-masked: a cloudy/coastal heat bbox yields nothing usable,
      // and a true-colour still is better than no imagery at all.
      if (!frame && view !== "truecolor") {
        frame = await fetchSatelliteFrame(bbox, { view: "truecolor", maxPx: SNAP_MAX_PX });
      }
      if (!frame) {
        empty++;
        continue;
      }
      if (frame.png.length > SNAP_MAX_BYTES) {
        tooBig++;
        continue;
      }
      // Only keep a frame whose OBSERVATION time actually moved (spec §6). GIBS daily
      // products (the true-colour mosaic, MODIS LST) only change once a day, so the hourly
      // sweep would otherwise store ~24 byte-identical frames per alert per day.
      const prior = await db.alertSnapshots.listForAlert(alert.source, alert.identifier);
      const obsMs = frame.observationTime.getTime();
      if (
        prior.some(
          (s) =>
            s.kind === "satellite" &&
            s.layer === frame!.view &&
            new Date(s.observationTime).getTime() === obsMs,
        )
      ) {
        unchanged++;
        continue;
      }
      await db.alertSnapshots.put({
        source: alert.source,
        identifier: alert.identifier,
        alertId: alert.id,
        kind: "satellite",
        layer: frame.view,
        hourSlot,
        bounds: bbox,
        width: frame.width,
        height: frame.height,
        observationTime: frame.observationTime,
        png: frame.png,
      });
      stored++;
    }

    const result = { targets: targets.length, stored, empty, tooBig, unchanged, oneShot: !!alertId };
    log(TAG, `snapshotSatellite done`, result);
    blogInfo(
      TAG,
      `alert satellite snapshots: ${stored}/${targets.length} (${unchanged} unchanged)`,
      result,
      "alerts",
      "snapshotSatellite",
    );
    if (stored) emitWorkerEvent({ type: ALERTS_UPDATED, data: { snapshots: stored } });
    return result;
  } catch (err) {
    log(TAG, `snapshotSatellite failed`, summarizeForLog(err));
    blogErr(TAG, `alert satellite snapshot failed`, err, "alerts", "snapshotSatellite");
    throw err;
  }
}

/**
 * Re-bake the whole alert-imagery pipeline in one shot: satellite frames → the
 * side-by-side before/after comparison → nearby-camera stills (only when enabled).
 * This is the `/admin/jobs` "Refresh alert imagery" button — the same sequence as
 * the `refresh:alert-snapshots` CLI one-shot — so an operator can force a fresh
 * capture (e.g. after the no-data/blank-frame fix) without shelling into the worker.
 * Dispatched as type "alerts", event "snapshotRefresh".
 */
export async function snapshotRefresh(job: Job) {
  if (!alertSnapshotEnabled()) {
    log(TAG, `snapshotRefresh skipped (ALERT_SNAPSHOT_ENABLED=false)`);
    return { skipped: true };
  }
  const satellite = await snapshotSatellite(job);
  const compare = await snapshotCompare(job);
  const cameras = cameraSnapshotsEnabled() ? await snapshotCameras(job) : { skipped: true };
  const result = { satellite, compare, cameras };
  log(TAG, `snapshotRefresh done`, result);
  return result;
}

/**
 * Bake a side-by-side "then vs now" comparison from an alert's earliest and
 * latest satellite snapshots (needs ≥2). Stored as a `kind:"compare"` snapshot on
 * disk; the sharp compositing lives in satimg/compare.ts (worker-only). Dispatched
 * as type "alerts", event "snapshotCompare".
 */
export async function snapshotCompare(job: Job) {
  if (!alertSnapshotEnabled()) return { skipped: true };
  const db = await getAppDb();
  const alertId: string | undefined = job.data?.data?.alertId;
  try {
    const alerts = alertId
      ? [await db.alerts.getById(alertId)].filter((a): a is NonNullable<typeof a> => !!a)
      : (await db.alerts.list({ activeOnly: true, severityMin: SNAP_MIN_SEV })).slice(0, SNAP_MAX);
    const hourSlot = hourSlotOf(new Date());
    let stored = 0;
    let skipped = 0;
    for (const alert of alerts) {
      const sats = (await db.alertSnapshots.listForAlert(alert.source, alert.identifier)).filter(
        (s) => s.kind === "satellite",
      );
      const latest = sats[0];
      const earliest = sats[sats.length - 1];
      if (!latest || !earliest || latest.id === earliest.id) {
        skipped++;
        continue;
      }
      const [a, b] = await Promise.all([db.alertSnapshots.getPng(earliest.id), db.alertSnapshots.getPng(latest.id)]);
      if (!a || !b) {
        skipped++;
        continue;
      }
      const { png, width, height } = await sideBySide(a.data, b.data, {
        captions: [capLabel(earliest.observationTime), capLabel(latest.observationTime)],
      });
      if (png.length > SNAP_MAX_BYTES) {
        skipped++;
        continue;
      }
      await db.alertSnapshots.put({
        source: alert.source,
        identifier: alert.identifier,
        alertId: alert.id,
        kind: "compare",
        layer: "satellite",
        hourSlot,
        width,
        height,
        observationTime: new Date(latest.observationTime),
        png,
      });
      stored++;
    }
    const result = { alerts: alerts.length, stored, skipped };
    log(TAG, `snapshotCompare done`, result);
    blogInfo(TAG, `alert satellite comparisons: ${stored}`, result, "alerts", "snapshotCompare");
    if (stored) emitWorkerEvent({ type: ALERTS_UPDATED, data: { compares: stored } });
    return result;
  } catch (err) {
    log(TAG, `snapshotCompare failed`, summarizeForLog(err));
    blogErr(TAG, `alert comparison failed`, err, "alerts", "snapshotCompare");
    throw err;
  }
}

/**
 * Capture stills from the nearest webcams to each interesting alert. Fetches the
 * cam's current image, perceptual-hashes it (satimg/phash.ts, worker-only) and
 * skips storing a near-identical frame (dHash ≤ PHASH_THRESHOLD vs the last one
 * for that cam) — so we don't hoard the same picture hour after hour. Opt-IN
 * (ALERT_CAMERA_SNAPSHOT_ENABLED=true) since it fetches + stores third-party
 * images; attribution is carried on the snapshot. Dispatched as event
 * "snapshotCameras".
 */
export async function snapshotCameras(job: Job) {
  if (!alertSnapshotEnabled() || !cameraSnapshotsEnabled()) return { skipped: true };
  const db = await getAppDb();
  const alertId: string | undefined = job.data?.data?.alertId;
  try {
    const alerts = alertId
      ? [await db.alerts.getById(alertId)].filter((a): a is NonNullable<typeof a> => !!a)
      : (await db.alerts.list({ activeOnly: true, severityMin: SNAP_MIN_SEV })).slice(0, SNAP_MAX);
    const hourSlot = hourSlotOf(new Date());
    let stored = 0;
    let deduped = 0;
    let failed = 0;
    for (const alert of alerts) {
      const geom = alert.info?.[0]?.area?.[0]?.geometry;
      const pt = geom ? alertRepPoint(geom) : null;
      if (!pt) continue;
      const near = await db.cams.nearMany({
        lng: pt[0],
        lat: pt[1],
        maxKm: CAM_RADIUS_KM,
        limit: CAM_LIMIT,
        status: "active",
      });
      const existing = await db.alertSnapshots.listForAlert(alert.source, alert.identifier);
      for (const { cam, distanceKm } of near) {
        if (!cam.imageUrl) continue;
        let bytes: Buffer;
        try {
          const res = await fetch(cam.imageUrl);
          if (!res.ok) {
            failed++;
            continue;
          }
          bytes = Buffer.from(await res.arrayBuffer());
        } catch {
          failed++;
          continue;
        }
        let png: Buffer;
        let meta: sharp.Metadata;
        try {
          png = await sharp(bytes).png().toBuffer();
          meta = await sharp(png).metadata();
        } catch {
          failed++;
          continue; // not a decodable image
        }
        const ph = await pHash(png);
        const prior = existing.find((s) => s.kind === "camera" && s.camId === cam.camId);
        if (prior?.pHash && hamming(prior.pHash, ph) <= PHASH_THRESHOLD) {
          deduped++;
          continue; // same picture as last time
        }
        const attribution = cam.attribution
          ? [cam.attribution.provider, cam.attribution.requiredText].filter(Boolean).join(" · ")
          : undefined;
        await db.alertSnapshots.put({
          source: alert.source,
          identifier: alert.identifier,
          alertId: alert.id,
          kind: "camera",
          layer: cam.camId, // per-cam hour slot
          hourSlot,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          observationTime: new Date(),
          png,
          pHash: ph,
          camId: cam.camId,
          distanceKm,
          attribution,
        });
        stored++;
      }
    }
    const result = { alerts: alerts.length, stored, deduped, failed };
    log(TAG, `snapshotCameras done`, result);
    blogInfo(TAG, `alert camera stills: ${stored} (${deduped} unchanged)`, result, "alerts", "snapshotCameras");
    if (stored) emitWorkerEvent({ type: ALERTS_UPDATED, data: { cameraShots: stored } });
    return result;
  } catch (err) {
    log(TAG, `snapshotCameras failed`, summarizeForLog(err));
    blogErr(TAG, `alert camera snapshot failed`, err, "alerts", "snapshotCameras");
    throw err;
  }
}
