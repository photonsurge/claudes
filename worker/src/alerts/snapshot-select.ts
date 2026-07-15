import { unionBboxOfAlert, padBbox, type Bbox } from "@photonsurge/shared/geo/polygon";
import type { iAlertModel } from "@photonsurge/shared/db/alert-model";
import type { SatelliteView } from "../satimg/frame";

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
  /** The view this hazard should be captured in (resolved once, here). */
  view: SatelliteView;
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
    // Skip hazards satellite imagery can't show at all (wind, air quality, frost …) —
    // no point spending a fetch + storage on a picture of nothing.
    const view = viewForAlert(alert);
    if (!view) continue;
    const bbox = alertSnapshotBbox(alert);
    if (!bbox) continue;
    out.push({ alert, bbox, view });
    if (out.length >= max) break;
  }
  return out;
}

/** The capture-hour bucket for a timestamp, e.g. "2026-07-12T15" — the snapshot dedup slot. */
export function hourSlotOf(d: Date): string {
  return d.toISOString().slice(0, 13);
}

/**
 * Heat-hazard wording (several languages — WMO relays member-service text verbatim, e.g.
 * CMA's "high temperature"). Deliberately narrow: mis-picking `landtemp` for a storm would
 * swap useful cloud imagery for a cloud-masked blank.
 */
const HEAT_RE =
  /\bheat\b|heat ?wave|high temperature|extreme temperature|hot weather|canicul|hitze|ola de calor|onda de calor|ondata di calore/i;

/**
 * Hazards a satellite still genuinely SHOWS: cloud/storm systems, precipitation, flood
 * water, snow/ice cover, smoke plumes, dust, volcanic ash. Tested BEFORE `BLIND_RE` so a
 * "Cyclone — damaging winds" reads as a storm rather than tripping the wind denylist.
 */
const VISIBLE_RE =
  /storm|cyclone|hurricane|typhoon|tornado|rain|monsoon|flood|snow|blizzard|\bice\b|fire|smoke|dust|sand|\bfog\b|\bash\b|volcan/i;

/**
 * Hazards NO optical/IR still can show — a true-colour photo of a wind advisory is a
 * picture of nothing, and an air-quality or frost warning is invisible from orbit. These
 * earn no satellite snapshot at all: we skip the fetch, the storage and the on-air slide
 * (which self-hides), rather than airing a bland stock-looking sky.
 */
const BLIND_RE =
  /\bwind\b|\bgale\b|squall|air quality|smog|pollution|\bfrost\b|freez|cold wave|lightning|avalanche|tsunami|earthquake|\buv\b|radiation/i;

/**
 * Which satellite view tells THIS alert's story — or `null` when satellite imagery is
 * simply irrelevant to the hazard (the caller then takes no snapshot).
 *
 * - Heat → `landtemp`: a true-colour still of a heatwave is a photo of cloudless sky; the
 *   land-surface-temperature raster shows the ground baking, and being a daily product it
 *   gives a real day-1-vs-day-4 compare. (The caller falls back to true-colour when the LST
 *   frame is too sparse — LST is land-only and cloud-masked, see gibs#GIBS_LANDTEMP_LAYERS.)
 * - Visible weather → `truecolor` (the clouds/smoke/flood ARE the story).
 * - Wind / air quality / frost / lightning … → `null`, no imagery worth capturing.
 *
 * Unknown wording DEFAULTS to true-colour on purpose. WMO relays member text verbatim in
 * many languages, so an allowlist would silently starve foreign-worded storms — the
 * flagship case. A denylist only skips hazards we positively know are invisible.
 */
export function viewForAlert(alert: Pick<iAlertModel, "info">): SatelliteView | null {
  const info = alert.info?.[0];
  const text = `${info?.event ?? ""} ${info?.headline ?? ""}`;
  if (HEAT_RE.test(text)) return "landtemp";
  if (VISIBLE_RE.test(text)) return "truecolor";
  if (BLIND_RE.test(text)) return null;
  return "truecolor";
}
