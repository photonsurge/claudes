import { unionBboxOfAlert, padBbox, type Bbox } from "@photonsurge/shared/geo/polygon";
import type { iAlertModel } from "@photonsurge/shared/db/alert-model";

/**
 * Which active alerts earn a satellite snapshot, and over what bbox. Pure so the
 * cap/geometry gating is unit-tested without a DB. The caller passes an already
 * severity-filtered, severity-sorted list (db.alerts.list({severityMin})), so
 * here we only drop geocode-only alerts (no polygon → no frame) and cap the count
 * — the key guard against snapshotting hundreds of minor warnings.
 */

export interface SnapshotTarget {
  alert: iAlertModel;
  bbox: Bbox;
}

/** Padded snapshot bbox for an alert, or null when it has no drawable geometry. */
export function alertSnapshotBbox(alert: Pick<iAlertModel, "info">): Bbox | null {
  const bb = unionBboxOfAlert(alert.info);
  return bb ? padBbox(bb, { frac: 0.3, minDeg: 1 }) : null;
}

export function selectSnapshotTargets(
  alerts: iAlertModel[],
  opts: { max?: number } = {},
): SnapshotTarget[] {
  const max = opts.max ?? 50;
  const out: SnapshotTarget[] = [];
  for (const alert of alerts) {
    const bbox = alertSnapshotBbox(alert);
    if (!bbox) continue;
    out.push({ alert, bbox });
    if (out.length >= max) break;
  }
  return out;
}

/** The capture-hour bucket for a timestamp, e.g. "2026-07-12T15" — the snapshot dedup slot. */
export function hourSlotOf(d: Date): string {
  return d.toISOString().slice(0, 13);
}
