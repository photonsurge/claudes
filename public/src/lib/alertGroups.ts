import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { alertHazard } from "./alerts";
import type { Alert } from "./alerts";
import type { HazardType } from "./hazard";

/**
 * Multi-source grouping: cluster alerts that describe the SAME event across
 * different sources, so the list shows one row that references every source that
 * reported it (e.g. "WMO + MeteoAlarm").
 *
 * Two match rules, strongest first:
 *
 * 1. **Same `capId` — exact.** WMO republishes the very national CAP message
 *    MeteoAlarm/NWS publish, so a shared canonical CAP identifier means it is
 *    literally one warning. No geometry or hazard reasoning can beat that.
 * 2. **Same hazard + overlapping footprint** — the fallback for everything with
 *    no capId (GDACS; WMO alerts not yet resolved; ~20% of WMO alerts whose CAP
 *    XML carries no identifier at all). True polygon intersection is too heavy
 *    for thousands of alerts, so bbox overlap is the proxy. Alerts without
 *    geometry can't be geo-matched, so each becomes its own group.
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
export function alertBbox(a: Alert): Bbox | null {
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

/** Does this alert have anything to draw? */
const hasGeom = (a: Alert): boolean =>
  (a.info ?? []).some((i) =>
    (i.area ?? []).some((ar) => !!(ar.geometry as { coordinates?: unknown } | null)?.coordinates),
  );

/**
 * Order members so `members[0]` is the right representative.
 *
 * **Geometry first, and that is load-bearing.** The overlay draws ONLY
 * representatives (`!a.groupId || a.id === a.groupId`), so electing a
 * geometry-less member would erase the whole group from the globe. That could
 * never happen while grouping was bbox-only — a null-bbox alert was always a
 * singleton — but exact capId merging puts a shapeless MeteoAlarm alert and a
 * WMO one with a polygon in the SAME group, so the guard is now essential.
 * Severity then recency decide among members that can all be drawn.
 */
const byRepresentative = (x: Alert, y: Alert): number =>
  Number(hasGeom(y)) - Number(hasGeom(x)) || sevOf(y) - sevOf(x) || sentMs(y) - sentMs(x);

/**
 * Merge groups whose members share a canonical CAP id.
 *
 * Runs AFTER the hazard/bbox pass rather than inside it, because a capId match
 * outranks both: the two copies can land in different hazard buckets (each source
 * words the event its own way) and one may have no footprint to overlap at all.
 * Union-find over group indices keeps a three-way pile-up (WMO + MeteoAlarm + NWS)
 * in one group.
 */
function mergeByCapId(groups: AlertGroup[]): AlertGroup[] {
  const byCapId = new Map<string, number[]>();
  groups.forEach((g, i) => {
    for (const m of g.members) {
      if (!m.capId) continue;
      const arr = byCapId.get(m.capId);
      if (arr) arr.push(i);
      else byCapId.set(m.capId, [i]);
    }
  });
  if (!byCapId.size) return groups;

  const parent = groups.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  let merged = false;
  for (const idxs of byCapId.values()) {
    for (let k = 1; k < idxs.length; k++) {
      const ri = find(idxs[0]);
      const rj = find(idxs[k]);
      if (ri !== rj) {
        parent[ri] = rj;
        merged = true;
      }
    }
  }
  if (!merged) return groups;

  const out = new Map<number, Alert[]>();
  groups.forEach((g, i) => {
    const root = find(i);
    const arr = out.get(root);
    if (arr) arr.push(...g.members);
    else out.set(root, [...g.members]);
  });
  return [...out.values()].map(toGroup);
}

/** Build a group from its members, electing the representative. */
function toGroup(members: Alert[]): AlertGroup {
  members.sort(byRepresentative);
  const representative = members[0];
  return {
    id: representative.id,
    hazard: alertHazard(representative),
    members,
    sources: Array.from(new Set(members.map((m) => m.source))).sort(),
    maxSeverityRank: members.reduce<SeverityRank>(
      (m, x) => (x.maxSeverityRank > m ? x.maxSeverityRank : m),
      0 as SeverityRank,
    ),
    representative,
  };
}

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
      groups.push({ ...toGroup(members), hazard });
    }
  }

  // Exact capId matches override everything the geometry pass decided.
  const out = mergeByCapId(groups);
  out.sort((a, b) => b.maxSeverityRank - a.maxSeverityRank || sentMs(b.representative) - sentMs(a.representative));
  return out;
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
    const g = toGroup(members);
    groups.push({
      ...g,
      id: g.representative.groupId ?? g.representative.id,
      // Prefer the server's full source set (survives client-side filtering).
      sources: Array.from(new Set(members.flatMap((m) => m.groupSources ?? [m.source]))).sort(),
    });
  }
  groups.sort((a, b) => b.maxSeverityRank - a.maxSeverityRank || sentMs(b.representative) - sentMs(a.representative));
  return groups;
}
