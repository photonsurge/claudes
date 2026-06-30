import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { alertHazard } from "./alerts";
import type { Alert } from "./alerts";
import type { HazardType } from "./hazard";

/**
 * Multi-source grouping: cluster alerts that describe the SAME event across
 * different sources, so the list shows one row that references every source that
 * reported it (e.g. "WMO + MeteoAlarm"). Match rule (operator-chosen): same
 * hazard category AND overlapping footprint. True polygon intersection is too
 * heavy for thousands of alerts in the browser, so we use bounding-box overlap
 * as the proxy — cheap and a good approximation for "same area". Alerts without
 * geometry can't be geo-matched, so each becomes its own group.
 */
export interface AlertGroup {
  id: string;
  hazard: HazardType;
  members: Alert[];
  /** Distinct sources that reported this event, sorted. */
  sources: string[];
  maxSeverityRank: SeverityRank;
  /** Highest-severity (then most recent) member — drives the row's display. */
  representative: Alert;
}

type Bbox = [number, number, number, number];

/** Walk arbitrarily-nested GeoJSON coordinates down to [lng,lat] pairs. */
function walkCoords(coords: unknown, fn: (x: number, y: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    fn(coords[0], coords[1]);
    return;
  }
  for (const c of coords) walkCoords(c, fn);
}

/** Bounding box over every area geometry of an alert, or null if none. */
function alertBbox(a: Alert): Bbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const info of a.info ?? []) {
    for (const area of info.area ?? []) {
      const g = area.geometry;
      if (!g || !(g as { coordinates?: unknown }).coordinates) continue;
      walkCoords((g as { coordinates: unknown }).coordinates, (x, y) => {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
    }
  }
  return found ? [minX, minY, maxX, maxY] : null;
}

const overlaps = (a: Bbox, b: Bbox): boolean =>
  !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);

const sevOf = (a: Alert): number => a.maxSeverityRank;
const sentMs = (a: Alert): number => {
  const t = Date.parse(a.sent || "");
  return Number.isFinite(t) ? t : 0;
};

/**
 * Group alerts by (hazard + overlapping footprint). Within each hazard bucket we
 * union members whose bboxes overlap (union-find). Returns groups sorted by max
 * severity then recency; members within a group sorted highest-severity first.
 */
export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  // Bucket by hazard first — events of different hazards never merge.
  const buckets = new Map<HazardType, { a: Alert; bbox: Bbox | null }[]>();
  for (const a of alerts) {
    const h = alertHazard(a);
    const arr = buckets.get(h) ?? [];
    arr.push({ a, bbox: alertBbox(a) });
    buckets.set(h, arr);
  }

  const groups: AlertGroup[] = [];
  for (const [hazard, items] of buckets) {
    // Union-find over items whose bboxes overlap. Null-bbox items stay singletons.
    const parent = items.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (i: number, j: number) => {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    };
    for (let i = 0; i < items.length; i++) {
      const bi = items[i].bbox;
      if (!bi) continue;
      for (let j = i + 1; j < items.length; j++) {
        const bj = items[j].bbox;
        if (bj && overlaps(bi, bj)) union(i, j);
      }
    }

    const clusters = new Map<number, Alert[]>();
    items.forEach((it, i) => {
      const root = it.bbox ? find(i) : -1 - i; // null-bbox → unique singleton key
      const arr = clusters.get(root) ?? [];
      arr.push(it.a);
      clusters.set(root, arr);
    });

    for (const [, members] of clusters) {
      members.sort((x, y) => sevOf(y) - sevOf(x) || sentMs(y) - sentMs(x));
      const representative = members[0];
      groups.push({
        id: representative.id,
        hazard,
        members,
        sources: Array.from(new Set(members.map((m) => m.source))).sort(),
        maxSeverityRank: members.reduce<SeverityRank>(
          (m, x) => (x.maxSeverityRank > m ? x.maxSeverityRank : m),
          0 as SeverityRank,
        ),
        representative,
      });
    }
  }

  groups.sort((a, b) => b.maxSeverityRank - a.maxSeverityRank || sentMs(b.representative) - sentMs(a.representative));
  return groups;
}

/**
 * Cheap O(n) regroup using the server-assigned `groupId` (no geometry math) — for
 * the client, which must NOT run the heavy `groupAlerts` on every render. Falls
 * back to ungrouped (each alert its own group) when groupId is absent.
 */
export function bucketByGroupId(alerts: Alert[]): AlertGroup[] {
  const buckets = new Map<string, Alert[]>();
  for (const a of alerts) {
    const key = a.groupId ?? a.id;
    const arr = buckets.get(key);
    if (arr) arr.push(a);
    else buckets.set(key, [a]);
  }
  const groups: AlertGroup[] = [];
  for (const [, members] of buckets) {
    members.sort((x, y) => sevOf(y) - sevOf(x) || sentMs(y) - sentMs(x));
    const representative = members[0];
    groups.push({
      id: representative.groupId ?? representative.id,
      hazard: alertHazard(representative),
      members,
      // Prefer the server's full source set (survives client-side filtering).
      sources: Array.from(new Set(members.flatMap((m) => m.groupSources ?? [m.source]))).sort(),
      maxSeverityRank: members.reduce<SeverityRank>((m, x) => (x.maxSeverityRank > m ? x.maxSeverityRank : m), 0 as SeverityRank),
      representative,
    });
  }
  groups.sort((a, b) => b.maxSeverityRank - a.maxSeverityRank || sentMs(b.representative) - sentMs(a.representative));
  return groups;
}
