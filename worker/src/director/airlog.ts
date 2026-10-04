/**
 * As-run recording for the auto-director: every cut (and each session's
 * start/end) is persisted via db.airLog so /admin/runs can replay what actually
 * aired. Recording is strictly best-effort — every helper swallows its own
 * errors, because a Mongo hiccup must never take down a cut or stall the loop.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { AirCut } from "@photonsurge/shared/db/air-log-repo";
import type { Segment } from "@photonsurge/shared/director";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "director:airlog";

/** The bits of the loop's per-scene runner state the log needs. */
export interface AirLogRunnerRef {
  sceneId: string;
  seq: number;
  timesShown?: number;
  /** The open AirRun's id — set here on the first cut of a session. */
  runId?: string;
}

/**
 * Record one cut, opening the session's run on the first one. `skipRequested`
 * is why the OUTGOING segment left the screen (operator skip vs. natural
 * expiry); `breaking` is whether the incoming pick came via the priority tier.
 */
export async function airLogCut(
  db: AppDb,
  r: AirLogRunnerRef,
  next: Segment,
  opts: {
    skipRequested: boolean;
    breaking: boolean;
    now: number;
    command?: { source: "operator" | "viewer" | "system"; author?: string };
  },
): Promise<void> {
  try {
    if (!r.runId) r.runId = await db.airLog.startRun(r.sceneId, new Date(opts.now));
    const cut: AirCut = {
      runId: r.runId,
      sceneId: r.sceneId,
      seq: r.seq,
      kind: next.kind,
      segmentId: next.id,
      title: next.title,
      subtitle: next.subtitle,
      icon: next.icon,
      breaking: opts.breaking,
      ...(opts.command ? { command: opts.command } : {}),
      ...(next.breakIn ? { breakIn: { reason: next.breakIn.reason, interrupted: next.breakIn.interrupted } } : {}),
      ...(next.breakIn?.items?.length ? { breakInItems: next.breakIn.items } : {}),
      timesShown: r.timesShown ?? 1,
      center: next.camera.center,
      zoom: next.camera.zoom,
      holdMs: next.holdMs,
      startedAt: new Date(opts.now),
      adId: next.ad?.adId,
      stops: next.summary?.stops?.map((s) => ({ label: s.label, subtitle: s.subtitle, lng: s.lng, lat: s.lat })),
      details: next.details,
    };
    await db.airLog.recordCut(cut, opts.skipRequested ? "skipped" : "expired");
  } catch (err) {
    log(TAG, `cut record failed`, { sceneId: r.sceneId, err: String(err) });
  }
}

/** Close the session's run when a scene leaves auto mode. */
export async function airLogSceneOff(db: AppDb, runId: string | undefined, now: number): Promise<void> {
  if (!runId) return;
  try {
    await db.airLog.endRun(runId, new Date(now));
  } catch (err) {
    log(TAG, `run close failed`, { runId, err: String(err) });
  }
}
