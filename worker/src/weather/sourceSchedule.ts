// weather/sourceSchedule.ts
// Single source of truth for the weather-source ingest fleet: every refresh
// handler, the descriptor id that GATES it (only enabled sources schedule), and
// the env knob + default cadence. Consumed by BOTH the scheduler (index.ts, which
// registers a repeatable + boot-kick per enabled entry) and the reset script
// (scripts/resetWeather.ts, which re-kicks the whole fleet after a wipe). Kept as
// static data — NO process.env reads at module load, so importing it before
// loadWorkerEnv() can't freeze stale cadences; callers read the env at runtime.

export interface WeatherSourceJob {
  /** jobs/weather.ts handler event, e.g. "refreshIconD2". */
  event: string;
  /** Descriptor id that gates scheduling (a sentinel when one job loops a family). */
  sourceId: string;
  /** Env var overriding the repeat cadence (ms). */
  envKey: string;
  /** Default cadence (ms) when the env var is unset. */
  defaultMs: number;
}

const MIN = 60 * 1000;

/** The whole ingest fleet, in schedule/registration order. */
export const WEATHER_SOURCE_JOBS: WeatherSourceJob[] = [
  { event: "refreshIfs", sourceId: "ifs", envKey: "IFS_INGEST_MS", defaultMs: 60 * MIN },
  { event: "refreshWaves", sourceId: "gfswave-mosaic", envKey: "WAVE_INGEST_MS", defaultMs: 60 * MIN },
  { event: "refreshRtofs", sourceId: "rtofs", envKey: "RTOFS_INGEST_MS", defaultMs: 180 * MIN },
  // Temperature-at-depth chapters; polls cheaply (alreadyPublished skips
  // before the 816MB download), so the same cadence as the surface run is fine.
  { event: "refreshRtofsDepth", sourceId: "rtofs-depth", envKey: "RTOFS_DEPTH_INGEST_MS", defaultMs: 180 * MIN },
  // Phase 2 regional nests (zoom-gated high-res overlays).
  { event: "refreshIconD2", sourceId: "icon-d2", envKey: "ICON_D2_INGEST_MS", defaultMs: 30 * MIN },
  { event: "refreshIconEu", sourceId: "icon-eu", envKey: "ICON_EU_INGEST_MS", defaultMs: 30 * MIN },
  { event: "refreshHrrr", sourceId: "hrrr", envKey: "HRRR_INGEST_MS", defaultMs: 30 * MIN },
  { event: "refreshMrms", sourceId: "mrms", envKey: "MRMS_INGEST_MS", defaultMs: 2 * MIN },
  // One job each loops a whole family, so a single sentinel id gates the group.
  { event: "refreshWaveNests", sourceId: "gfswave-atlocn", envKey: "WAVE_NEST_INGEST_MS", defaultMs: 60 * MIN },
  { event: "refreshRtofsRegional", sourceId: "rtofs-westatl", envKey: "RTOFS_REGIONAL_INGEST_MS", defaultMs: 180 * MIN },
  // "Everywhere" nests: worldwide 13 km + Canada 2.5 km + UK 2 km.
  { event: "refreshIconGlobal", sourceId: "icon-global", envKey: "ICON_GLOBAL_INGEST_MS", defaultMs: 60 * MIN },
  { event: "refreshHrdps", sourceId: "hrdps", envKey: "HRDPS_INGEST_MS", defaultMs: 30 * MIN },
  { event: "refreshUkv", sourceId: "ukv", envKey: "UKV_INGEST_MS", defaultMs: 30 * MIN },
  // Open-Meteo `.om` spatial nests (JMA Japan now; AU/CN/KR one-line adds). One job
  // loops the whole OM_MODELS family, gated by the JMA source id.
  { event: "refreshOpenMeteo", sourceId: "jma-msm", envKey: "OPENMETEO_INGEST_MS", defaultMs: 30 * MIN },
];

/** Resolve an entry's repeat cadence (ms) from its env knob, at call time. */
export function jobEveryMs(job: WeatherSourceJob): number {
  return Number(process.env[job.envKey] || job.defaultMs);
}
