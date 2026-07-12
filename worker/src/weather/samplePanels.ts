// weather/samplePanels.ts
// Build the on-air PANEL series (point + area history) for a batch of catalog
// entities (countries / regions) with the decode-once-sample-all discipline: for
// each variable, every archived frame in the window is sharp-decoded AT MOST
// ONCE and sampled for every entity that picked it — never per-entity, which
// would be entities × frames decodes. This is the worker-side counterpart of
// public's per-request buildHistorySeries/buildAreaHistorySeries, and produces
// the IDENTICAL HistorySeries/AreaHistorySeries shapes so a precomputed panel
// drops straight into a FocusBundle.
import type { getAppDb } from "@photonsurge/shared/db/index";
import {
  sampleFrame,
  areaStatsFrame,
  seriesStats,
  type FrameSample,
  type AreaStats,
} from "@photonsurge/shared/weather/sample";
import { pickFramesForPoint } from "@photonsurge/shared/weather/pick";
import type {
  HistoryPoint,
  HistorySeries,
  AreaHistoryPoint,
  AreaHistorySeries,
} from "@photonsurge/shared/weather/history-types";
import type { WeatherFrameMeta } from "@photonsurge/shared/db/weather-frame-repo";
import { decodeFrame, type DecodableFrame } from "./frameDecode";

type Db = Awaited<ReturnType<typeof getAppDb>>;

/** One thing to precompute: a representative point + an area bbox. */
export interface PanelEntity {
  id: string;
  lat: number;
  lng: number;
  bbox: [number, number, number, number];
}

export interface EntityPanels {
  pointHistory: HistorySeries[];
  areaHistory: AreaHistorySeries[];
}

/** bbox centre, wrapping the antimeridian like buildAreaHistorySeries does. */
function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  const lat = (bbox[1] + bbox[3]) / 2;
  let lng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) lng = ((bbox[0] + bbox[2] + 360) / 2 + 180) % 360 - 180;
  return [lng, lat];
}

/** Assemble one variable's POINT series for an entity — mirrors buildHistorySeries. */
function assemblePoint(
  variable: string,
  picks: WeatherFrameMeta[],
  samples: Map<string, FrameSample | null>,
  lat: number,
  lng: number,
): HistorySeries {
  const series: HistoryPoint[] = [];
  const statValues: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";
  for (const f of picks) {
    encoding = f.encoding;
    units = f.units || units;
    const sample = samples.get(f.id);
    if (!sample) continue;
    const point: HistoryPoint = { t: new Date(f.validTime).toISOString(), model: f.model, fhr: f.fhr };
    if (sample.kind === "scalar") {
      point.value = sample.value;
      statValues.push(sample.value);
    } else {
      point.u = sample.u;
      point.v = sample.v;
      point.speed = sample.speed;
      statValues.push(sample.speed);
    }
    series.push(point);
  }
  return { variable, encoding, units, lat, lng, series, stats: seriesStats(statValues) };
}

/** Assemble one variable's AREA series for an entity — mirrors buildAreaHistorySeries. */
function assembleArea(
  variable: string,
  picks: WeatherFrameMeta[],
  stats: Map<string, AreaStats | null>,
  bbox: [number, number, number, number],
): AreaHistorySeries {
  const series: AreaHistoryPoint[] = [];
  const means: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";
  let areaMin: number | null = null;
  let areaMax: number | null = null;
  for (const f of picks) {
    encoding = f.encoding;
    units = f.units || units;
    const s = stats.get(f.id);
    if (!s) continue;
    series.push({ t: new Date(f.validTime).toISOString(), model: f.model, fhr: f.fhr, mean: s.mean, min: s.min, max: s.max });
    means.push(s.mean);
    areaMin = areaMin == null ? s.min : Math.min(areaMin, s.min);
    areaMax = areaMax == null ? s.max : Math.max(areaMax, s.max);
  }
  return { variable, encoding, units, bbox, series, stats: seriesStats(means), areaMin, areaMax };
}

function addNeeder(map: Map<string, number[]>, id: string, ei: number): void {
  const arr = map.get(id);
  if (arr) arr.push(ei);
  else map.set(id, [ei]);
}

/**
 * Point + area history for every entity, per variable. Peak memory is ONE
 * decoded frame at a time (plus the small sampled scalars) — the frame bytes are
 * loaded, sampled for all needers, and released before the next frame.
 */
export async function buildEntityPanels(
  db: Db,
  entities: PanelEntity[],
  variables: string[],
  from: Date,
): Promise<Map<string, EntityPanels>> {
  const out = new Map<string, EntityPanels>(
    entities.map((e) => [e.id, { pointHistory: [], areaHistory: [] }]),
  );
  if (!entities.length) return out;

  for (const variable of variables) {
    const metas = await db.weatherFrames.listMeta({ variable, from });
    if (!metas.length) {
      // No frames for this variable in-window: emit empty series so the panel
      // shape stays branch-free for consumers (matches an empty live build).
      for (const e of entities) {
        out.get(e.id)!.pointHistory.push(assemblePoint(variable, [], new Map(), e.lat, e.lng));
        out.get(e.id)!.areaHistory.push(assembleArea(variable, [], new Map(), e.bbox));
      }
      continue;
    }

    // Per-entity finest-covering frame selection (pure, meta-only).
    const ptPicks = entities.map((e) => pickFramesForPoint(metas, e.lat, e.lng));
    const arPicks = entities.map((e) => {
      const [clng, clat] = bboxCenter(e.bbox);
      return pickFramesForPoint(metas, clat, clng);
    });

    // frameId -> the entity indices that need it (so a decoded frame is sampled
    // only for the entities whose pick includes it).
    const ptNeeders = new Map<string, number[]>();
    const arNeeders = new Map<string, number[]>();
    ptPicks.forEach((ps, ei) => ps.forEach((m) => addNeeder(ptNeeders, m.id, ei)));
    arPicks.forEach((ps, ei) => ps.forEach((m) => addNeeder(arNeeders, m.id, ei)));

    const ptSamples = entities.map(() => new Map<string, FrameSample | null>());
    const arSamples = entities.map(() => new Map<string, AreaStats | null>());

    const neededIds = new Set<string>([...ptNeeders.keys(), ...arNeeders.keys()]);
    for (const id of neededIds) {
      const frame = await db.weatherFrames.getByID(id);
      if (!frame) continue;
      let grid;
      try {
        grid = await decodeFrame(frame as unknown as DecodableFrame);
      } catch {
        continue; // undecodable frame reads as nodata for every needer
      }
      for (const ei of ptNeeders.get(id) ?? []) {
        ptSamples[ei].set(id, sampleFrame(grid, entities[ei].lat, entities[ei].lng));
      }
      for (const ei of arNeeders.get(id) ?? []) {
        arSamples[ei].set(id, areaStatsFrame(grid, entities[ei].bbox));
      }
    }

    entities.forEach((e, ei) => {
      const panels = out.get(e.id)!;
      panels.pointHistory.push(assemblePoint(variable, ptPicks[ei], ptSamples[ei], e.lat, e.lng));
      panels.areaHistory.push(assembleArea(variable, arPicks[ei], arSamples[ei], e.bbox));
    });
  }

  return out;
}
