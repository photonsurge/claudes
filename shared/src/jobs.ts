/**
 * Operator-triggerable worker jobs — the single source of truth for the admin
 * "Jobs" panel and the enqueue API. Each maps to a BullMQ `{ domain, type, event }`
 * routed to `worker/src/jobs/<type>.ts#<event>`. Keep this an allowlist so the
 * admin can only enqueue known, safe jobs.
 */
export interface TriggerableJob {
  id: string;
  label: string;
  description: string;
  domain: string;
  type: string;
  event: string;
  /** UI section header on the admin Jobs page (jobs render grouped by this). */
  group: string;
  /** BullMQ priority (1 high, 5 normal, 10 low). Admin triggers default high. */
  priority?: 1 | 5 | 10;
  /**
   * Optional preset payload merged into the enqueue `data` (e.g. a city seed
   * tier). Lets several buttons target the same handler with different params
   * without a bespoke form — the admin POST route spreads this over `data`.
   */
  data?: Record<string, unknown>;
}

/**
 * City-overlay dataset jobs. The seed variants are the tier "picker": each button
 * reseeds the cities collection from a different GeoNames population floor (finer
 * tier = more small towns, revealed progressively by zoom). Enrichment fetches
 * Wikipedia photo/blurb for prominent cities — run it AFTER a reseed (a reseed
 * replaces the collection, dropping the cached enrichment).
 */
const CITY_JOBS: TriggerableJob[] = [
  ["cities-seed-15k", "Reseed cities · towns ≥15k (default)", "cities15000", "≈27k places."],
  ["cities-seed-5k", "Reseed cities · towns ≥5k", "cities5000", "≈55k places."],
  ["cities-seed-1k", "Reseed cities · small towns ≥1k", "cities1000", "≈140k places."],
  ["cities-seed-500", "Reseed cities · everything ≥500", "cities500", "≈200k places, heaviest."],
].map(([id, label, tier, size]) => ({
  id,
  label,
  description: `Replace the cities overlay dataset from GeoNames ${tier} — ${size} Drops cached Wikipedia enrichment; re-run enrichment after.`,
  domain: "cities",
  type: "cities",
  event: "seed",
  group: "Cities",
  data: { tier },
}));

/**
 * Weather-map source refreshes. Each maps to a `weather.<event>` handler in
 * worker/src/jobs/weather.ts, mirroring the scheduled ingest fleet
 * (worker/src/weather/sourceSchedule.ts) so the operator can force a "run now".
 * A worker test cross-checks these events against the real fleet to catch drift.
 */
const WEATHER_MAP_JOBS: TriggerableJob[] = (
  [
    ["weather-ifs", "ECMWF IFS (global)", "Re-ingest the ECMWF IFS global base (off by default until CCSDS-validated).", "refreshIfs"],
    ["weather-waves", "GFS-Wave (global mosaic)", "Re-ingest the global GFS-Wave height/direction mosaic.", "refreshWaves"],
    ["weather-rtofs", "RTOFS ocean (global)", "Re-ingest the global RTOFS SST / currents / salinity base.", "refreshRtofs"],
    ["weather-rtofs-depth", "RTOFS temperature-at-depth (global)", "Re-ingest the global RTOFS 100/500/2000/5000m ocean temperature chapters.", "refreshRtofsDepth"],
    ["weather-icon-global", "ICON global (13 km, everywhere)", "Re-ingest DWD ICON 13 km — the worldwide zoom-in bump under regional nests.", "refreshIconGlobal"],
    ["weather-icon-eu", "ICON-EU (Europe 6.5 km)", "Re-ingest the DWD ICON-EU regional nest.", "refreshIconEu"],
    ["weather-icon-d2", "ICON-D2 (central Europe 2 km)", "Re-ingest the DWD ICON-D2 high-res nest.", "refreshIconD2"],
    ["weather-hrrr", "HRRR (US 3 km)", "Re-ingest the NOAA HRRR CONUS nest.", "refreshHrrr"],
    ["weather-mrms", "MRMS (US radar)", "Re-ingest the NOAA MRMS radar mosaic (nest-only).", "refreshMrms"],
    ["weather-hrdps", "HRDPS (Canada 2.5 km)", "Re-ingest the ECCC HRDPS nest.", "refreshHrdps"],
    ["weather-ukv", "UKV (UK 2 km)", "Re-ingest the Met Office UKV nest.", "refreshUkv"],
    ["weather-openmeteo", "Open-Meteo nests (JMA, AROME, …)", "Re-ingest the Open-Meteo .om national high-res family.", "refreshOpenMeteo"],
    ["weather-wave-nests", "GFS-Wave basin nests", "Re-ingest the regional GFS-Wave basin nests.", "refreshWaveNests"],
    ["weather-rtofs-regional", "RTOFS regional windows", "Re-ingest the 11 regional RTOFS windows.", "refreshRtofsRegional"],
  ] as const
).map(([id, label, description, event]) => ({
  id,
  label,
  description,
  domain: "weather",
  type: "weather",
  event,
  group: "Weather maps",
}));

export const TRIGGERABLE_JOBS: TriggerableJob[] = [
  {
    id: "weather-check",
    label: "Check weather run",
    description: "Look for a newer GFS run and bake it.",
    domain: "weather",
    type: "weather",
    event: "check",
    group: "Weather maps",
  },
  ...WEATHER_MAP_JOBS,
  {
    id: "forecast-backfill",
    label: "Backfill 3-day forecast",
    description:
      "Copy every published run's steps into the rolling forecast store — use once after deploying the forecast feature, or any time the daily-outlook strip looks stale.",
    domain: "weather",
    type: "forecast",
    event: "backfill",
    group: "Weather maps",
  },
  {
    id: "alerts-ingest",
    label: "Ingest alerts",
    description: "Pull active NWS alerts into Mongo.",
    domain: "alerts",
    type: "alerts",
    event: "ingest",
    group: "Alerts & events",
  },
  {
    id: "tles",
    label: "Refresh satellite TLEs",
    description: "Fetch the configured Celestrak groups into Mongo.",
    domain: "tracks",
    type: "tracks",
    event: "ingestTles",
    group: "Tracks",
  },
  {
    id: "snapshot-aircraft",
    label: "Snapshot aircraft",
    description: "Cache a fresh ADS-B frame for the overlay.",
    domain: "tracks",
    type: "tracks",
    event: "snapshotAircraft",
    group: "Tracks",
  },
  {
    id: "snapshot-ships",
    label: "Snapshot ships",
    description: "Cache a fresh AIS frame (needs AISSTREAM_API_KEY).",
    domain: "tracks",
    type: "tracks",
    event: "snapshotShips",
    group: "Tracks",
  },
  {
    id: "snapshot-seismic",
    label: "Snapshot earthquakes",
    description: "Cache recent USGS earthquakes for the overlay.",
    domain: "tracks",
    type: "tracks",
    event: "snapshotSeismic",
    group: "Tracks",
  },
  {
    id: "refresh-seismo-stations",
    label: "Refresh seismograph stations",
    description: "Rebuild the global GSN broadband-station catalog used to pick live waveform stations near what's on air.",
    domain: "seismo",
    type: "seismo",
    event: "refreshStations",
    group: "Tracks",
  },
  {
    id: "refresh-tide-stations",
    label: "Refresh tide stations",
    description: "Rebuild the global IOC sea-level gauge catalog.",
    domain: "tides",
    type: "tides",
    event: "refreshStations",
    group: "Tracks",
  },
  {
    id: "snapshot-tides",
    label: "Snapshot tide gauges",
    description: "Cache water-level series for gauges near what's on air.",
    domain: "tides",
    type: "tides",
    event: "snapshotTides",
    group: "Tracks",
  },
  {
    id: "summaries-hourly",
    label: "Round-up (hourly)",
    description: "Generate the hourly global weather-event round-up.",
    domain: "summaries",
    type: "summaries",
    event: "generateHourly",
    group: "Alerts & events",
  },
  {
    id: "summaries-12h",
    label: "Round-up (12-hour)",
    description: "Generate the 12-hour global weather-event round-up.",
    domain: "summaries",
    type: "summaries",
    event: "generate12h",
    group: "Alerts & events",
  },
  {
    id: "summaries-daily",
    label: "Round-up (daily)",
    description: "Generate the daily global weather-event round-up.",
    domain: "summaries",
    type: "summaries",
    event: "generateDaily",
    group: "Alerts & events",
  },
  ...CITY_JOBS,
  {
    id: "cities-enrich",
    label: "Enrich cities (Wikipedia)",
    description: "Fetch a Wikipedia photo + blurb for prominent cities (≥100k + capitals). Run after a reseed.",
    domain: "cities",
    type: "cities",
    event: "enrichWiki",
    group: "Cities",
  },
  {
    id: "cities-enrich-all",
    label: "Enrich all cities (Wikipedia)",
    description: "Fetch a Wikipedia photo + blurb for every city in restartable batches of 100. Fresh cities are skipped.",
    domain: "cities",
    type: "cities",
    event: "enrichWikiAll",
    group: "Cities",
    priority: 10,
  },
  {
    id: "director-seed-slides",
    label: "Seed look slides",
    description:
      "Backfill the \"Look per shot type\" starter slide library onto every scene's director config. Only fills a kind with no saved slides yet — never overwrites what an operator has saved.",
    domain: "director",
    type: "director",
    event: "seedSlides",
    group: "Director",
  },
  {
    id: "director-clear-slides",
    label: "Clear look slides",
    description:
      "Wipe every scene's saved \"Look per shot type\" slide library back to empty — including any slide an operator saved by hand. Run \"Seed look slides\" after to lay down the starter set again.",
    domain: "director",
    type: "director",
    event: "clearSlides",
    group: "Director",
  },
  {
    id: "elevation-bake",
    label: "Bake elevation relief",
    description:
      "Download ETOPO 2022 terrain + ocean-floor bathymetry and bake the static elevation contour texture (~466 MB download, one-time; drives the Terrain → Elevation contours overlay).",
    domain: "elevation",
    type: "elevation",
    event: "refresh",
    group: "Static datasets",
  },
  {
    id: "volcanoes-snapshot",
    label: "Refresh active volcanoes",
    description: "Re-pull NASA EONET's currently-active (\"open\") volcano events into Mongo now.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "snapshot",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-enrich",
    label: "Enrich volcanoes (Wikipedia)",
    description: "Fetch a Wikipedia photo + blurb for each active volcano. Fresh ones (< 30 days) are skipped.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "enrichWiki",
    group: "Volcanoes",
  },
];

export const getTriggerableJob = (id: string): TriggerableJob | undefined =>
  TRIGGERABLE_JOBS.find((j) => j.id === id);
