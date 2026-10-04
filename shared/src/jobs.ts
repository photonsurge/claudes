/**
 * Operator-triggerable worker jobs — the single source of truth for the admin
 * "Jobs" panel and the enqueue API. Each maps to a BullMQ `{ domain, type, event }`
 * routed to `worker/src/jobs/<type>.ts#<event>`. Keep this an allowlist so the
 * admin can only enqueue known, safe jobs.
 */
import { BASEMAP_TEXTURES } from "./basemaps";
/**
 * The human label for a queued job: "alerts.ingest:wmo".
 *
 * The qualifier matters because some jobs are registered ONE PER SOURCE — alerts
 * has a repeatable each for WMO, MeteoAlarm and GDACS — so /admin/queue showed
 * four identical `alerts.ingest` rows running at once with no way to tell which
 * was which, or whether one job was stuck in a loop. (It wasn't: that fan-out is
 * deliberate, so a slow WMO fetch can't block MeteoAlarm.)
 *
 * `source` only, not every data key: this is a queue row, not a debugger. The
 * source is the one thing that makes two rows of the same job different.
 */
export function jobLabel(data?: {
  type?: string;
  event?: string;
  data?: { source?: string } | null;
}): string | null {
  if (!data?.type || !data?.event) return null;
  const source = data.data?.source;
  return source ? `${data.type}.${data.event}:${source}` : `${data.type}.${data.event}`;
}

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
  /**
   * Self-chaining jobs (e.g. cities-enrich-all) can be halted mid-run: the admin
   * Jobs page shows a "Stop" button that removes every not-yet-started link
   * still queued for this job's `type`/`event` via the queue `stopChain` action.
   */
  stoppable?: boolean;
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

/**
 * Basemap base-image refreshes — one button per full-globe texture plus an "all".
 * Each downloads the texture, validates it FULLY decodes (the guard that would
 * have caught the truncated satellite.jpg), and writes it to the shared ${BLOB_DIR}
 * store, which /api/basemap/[id] serves in place of the read-only /data file. So a
 * corrupt or stale base image is now fixable from /admin/jobs without a redeploy.
 */
const BASEMAP_JOBS: TriggerableJob[] = [
  ...BASEMAP_TEXTURES.map((t) => ({
    id: `basemap-refresh-${t.id}`,
    label: `Refresh basemap: ${t.label}`,
    description: `Download the ${t.label} full-globe base image (${t.source}), verify it decodes, and store it in the shared blob store served under the raster basemap. Fixes a corrupt/stale zoomed-out globe without a redeploy.`,
    domain: "basemap",
    type: "basemap",
    event: "refresh",
    group: "Basemap textures",
    data: { texture: t.id },
  })),
  {
    id: "basemap-refresh-all",
    label: "Refresh ALL basemap textures",
    description:
      "Re-download and validate every full-globe base image (Satellite, Terrain, Night) into the shared blob store. Each is fetched independently — one bad upstream doesn't sink the rest.",
    domain: "basemap",
    type: "basemap",
    event: "refresh",
    group: "Basemap textures",
    data: { texture: "all" },
  },
];

/**
 * Scripted short videos (docs/short-video-plan.md). Seeding comes first: nothing
 * plays until the default format and its hidden scene exist. The generate
 * buttons are presets of the same handler the /admin/shorts form calls — a
 * quick way to make a round-up script without opening that page.
 */
const SHORT_VIDEO_JOBS: TriggerableJob[] = [
  {
    id: "short-video-seed-format",
    label: "Seed default short format",
    description:
      "Create the default short format and the hidden scene it plays on (shorts). Skips what already exists, so it never overwrites an operator's look or settings — run it once per deployment.",
    domain: "shorts",
    type: "short-video",
    event: "seedFormat",
    group: "Short videos",
  },
  {
    id: "short-video-generate-world",
    label: "Generate world round-up video",
    description:
      "Write a draft script for a world round-up video. Fails with the reason when there is no fresh world round-up. Open /admin/shorts to preview it.",
    domain: "shorts",
    type: "short-video",
    event: "generate",
    group: "Short videos",
    data: { scope: { type: "globe" } },
  },
];

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
    id: "weather-clear-gfs",
    label: "Clear GFS data",
    description:
      "Delete every stored GFS run + its baked textures, so the globe shows no GFS overlay until a fresh run bakes. Does NOT touch the long-term history archive. Run \"Check weather run\" afterwards to rebake the current cycle.",
    domain: "weather",
    type: "weather",
    event: "clearGfs",
    group: "Weather maps",
  },
  {
    id: "weather-reingest",
    label: "Remake weather for maps (rebake GFS)",
    description:
      "Delete the stored GFS runs and re-bake the latest GFS cycle from scratch, so every weather map-type overlay (temp/wind/rain/cloud…) and the 3-day forecast refresh. Use after a pipeline change, or if the base map shows \"updated Nd ago\". One click = \"Clear GFS data\" + \"Check weather run\"; the other models (IFS/RTOFS/radar…) are left untouched.",
    domain: "weather",
    type: "weather",
    event: "reingest",
    group: "Weather maps",
  },
  {
    id: "weather-thin-archive-dry",
    label: "Check weather archive thinning (dry run)",
    description:
      "Count what archive thinning WOULD drop, deleting nothing. The long-term frame archive was written keep-forever while radar (MRMS) added a frame every 2 minutes, which is what filled the disk. Thinning keeps every frame inside the full-res window (WEATHER_ARCHIVE_FULLRES_HOURS, default 96h), then ONE frame per map + variable per UTC day forever, and drops the zoom-gated regional nests past WEATHER_ARCHIVE_NEST_KEEP_DAYS (default 7). Read this first, then run the real one.",
    domain: "weather",
    type: "weather",
    event: "thinArchive",
    group: "Weather maps",
    data: { dryRun: true },
  },
  {
    id: "weather-thin-archive",
    label: "Thin weather archive (keep one a day)",
    description:
      "Apply archive thinning for real: keep every frame inside the full-res window, one frame per map + variable per UTC day beyond it (kept forever), and drop zoom-gated regional nests past their shorter window. Runs daily on its own; this button forces it. Nothing on air reads the archive further back than 72h, so the daily keepers are what a past day looks like. Pause with WEATHER_ARCHIVE_THIN=off while backfilling.",
    domain: "weather",
    type: "weather",
    event: "thinArchive",
    group: "Weather maps",
  },
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
    id: "satimg-refresh",
    label: "Refresh satellite imagery (globe cloud layer)",
    description:
      "Re-bake the satellite-imagery overlay: the GIBS true-colour global mosaic (cloud-keyed) plus the geostationary discs/looks and lightning, into the frame cache. Run after a satimg pipeline change, or if the cloud overlay looks stale or blank. The mosaic now composites the instrument layers client-side, so a dead layer (e.g. VIIRS_SNPP) no longer blanks the globe. Same as `yarn refresh:satimg`.",
    domain: "satimg",
    type: "satimg",
    event: "refresh",
    group: "Satellite imagery",
  },
  ...BASEMAP_JOBS,
  {
    id: "climate-backfill",
    label: "Backfill city climate (past year, all ≥100k)",
    description:
      "Fetch the past year of ERA5 climate for every city ≥100k population (deduped to ~5.4k 0.1° points) in restartable LOW-priority batches, so the director PAST YEAR / monthly-climate panel has a nearby cached point everywhere — not just what the live camera has framed. Fresh points (<6 days) are skipped; re-runs weekly to stay under the 14-day cache TTL. Use Stop to halt a sweep in progress.",
    domain: "climate",
    type: "climate",
    event: "backfillClimate",
    group: "Climate",
    priority: 10,
    data: { minPopulation: 100_000 },
    stoppable: true,
  },
  {
    id: "frame-blobs-migrate",
    label: "Migrate frame textures → sidecar",
    description:
      "One-off: move WeatherFrame + WeatherForecastFrame texture bytes out of the metadata docs into their WeatherFrameData/WeatherForecastFrameData sidecar collections, so history metadata scans stop paging the whole texture archive through Mongo (the fix for high Mongo memory/IO). Run ONCE after deploying the blob-store split. Idempotent + crash-safe; the first run is heavy (reads every inline blob once, in low-priority batches). Same as `yarn migrate:frame-blobs`.",
    domain: "maintenance",
    type: "maintenance",
    event: "migrateFrameBlobs",
    group: "Maintenance",
    priority: 10,
  },
  {
    id: "blobs-migrate",
    label: "Migrate blobs → shared disk",
    description:
      "One-off: move EVERY Mongo-stored binary payload (baked textures, both frame archives + their sidecars, aurora/geomag/satimg caches, and ad + admin-image uploads) onto the shared ${BLOB_DIR} folder, taking the binary archive off the database server (lighter backups/replication/IO). Requires BLOB_DIR to be set + mounted into the worker (no-op without it). Copy-and-verify then drop, so it's safe on the irreplaceable ad/image uploads; idempotent — re-run any time. Run ONCE after deploying the shared-folder split. Same as `yarn migrate:blobs`.",
    domain: "maintenance",
    type: "maintenance",
    event: "migrateBlobs",
    group: "Maintenance",
    priority: 10,
  },
  {
    id: "blobs-measure",
    label: "Measure blob folder disk usage",
    description:
      "Walk the shared blob folder and cache how much each namespace is using, for the Files page. The walk checks every single file, which at this size takes far too long to do inside a page load — the Files page would sit there until the reverse proxy gave up and returned an error page. So the worker measures on a schedule (and at start-up) and the page reads the answer instantly. This button forces a fresh measurement.",
    domain: "maintenance",
    type: "maintenance",
    event: "measureBlobs",
    group: "Maintenance",
    priority: 10,
  },
  {
    id: "blobs-orphans",
    label: "Check for orphaned blobs (report only)",
    description:
      "List files in the shared blob folder that no database record points at, deleting nothing. Every read goes record → file, so an orphan is invisible to the app and nothing would ever remove it — a prune that died between the two deletes, or an interrupted migration, leaves them behind forever. Reports per namespace with a size total. Namespaces with no owning collection (basemap textures) are reported as not swept rather than guessed at.",
    domain: "maintenance",
    type: "maintenance",
    event: "sweepOrphanBlobs",
    group: "Maintenance",
    priority: 10,
  },
  {
    id: "blobs-orphans-purge",
    label: "Delete orphaned blobs",
    description:
      "Actually delete the files the orphan report lists. Run the report first and read it. Files written in the last 15 minutes are always spared, in case a record is still being written alongside them.",
    domain: "maintenance",
    type: "maintenance",
    event: "sweepOrphanBlobs",
    group: "Maintenance",
    priority: 10,
    data: { apply: true },
  },
  {
    id: "alerts-ingest",
    label: "Ingest alerts",
    description:
      "Pull active warnings into Mongo from WMO SWIC (global), MeteoAlarm (the European authorities WMO doesn't carry — UK, DE, NL, IE, DK) and GDACS. NWS is off unless ALERTS_NWS_ENABLED=true, since WMO already carries the US. Unchanged alerts are skipped, so re-running is cheap.",
    domain: "alerts",
    type: "alerts",
    event: "ingest",
    group: "Alerts & events",
  },
  {
    id: "alerts-reconcile",
    label: "Reconcile stored alerts & events",
    description:
      "Fix what's already in the database, regardless of what the feeds just said. Retires MeteoAlarm's green \"nothing expected\" advisories (57% of that feed — not warnings, and they were drawn as such), re-ranks stored alerts from their own awareness level rather than the CAP severity that contradicts it, closes watched events whose warning has lapsed, and drops acquisition schedules nothing can fetch for. Needed because an unchanged alert is never rewritten, so fixing a RULE only ever reaches NEW alerts — the live ones keep the old answer until they expire. Idempotent: re-running when everything is already correct writes nothing.",
    domain: "alerts",
    type: "alerts",
    event: "reconcile",
    group: "Alerts & events",
  },
  {
    id: "alerts-translate",
    label: "Translate alerts (LLM)",
    description:
      "LLM-translate non-English Severe/Extreme active alerts' headline/description/instruction to English. Requires OPENROUTER_API_KEY; no-ops without it. Unchanged alerts are skipped on repeat runs.",
    domain: "alerts",
    type: "alerts",
    event: "translate",
    group: "Alerts & events",
  },
  {
    id: "alerts-snapshot-refresh",
    label: "Refresh alert imagery",
    description:
      "Re-bake the alert before/after imagery for every interesting active alert: a fresh GIBS satellite frame → the side-by-side before/after comparison → nearby-camera stills (only when ALERT_CAMERA_SNAPSHOT_ENABLED=true). GIBS daytime no-data regions (polar night / off-swath) now return NO frame instead of a black box, and newest-first means a good re-bake supersedes a stale one on the alert detail card. Same as `yarn refresh:alert-snapshots`.",
    domain: "alerts",
    type: "alerts",
    event: "snapshotRefresh",
    group: "Alerts & events",
  },
  {
    id: "alerts-prune-snapshots-dry",
    label: "Check alert imagery pruning (dry run)",
    description:
      "Count what alert-imagery retention WOULD drop, deleting nothing. Alert stills were never pruned by anything, and the hourly before/after comparison re-stored a byte-identical image every hour, which is what filled the disk. Retention keeps every still inside ALERT_SNAPSHOT_FULLRES_HOURS (default 72h), then the newest per alert + kind per UTC day, then nothing past ALERT_SNAPSHOT_KEEP_DAYS (default 30) except one keepsake still for alerts that actually aired. Read this first.",
    domain: "alerts",
    type: "alerts",
    event: "pruneSnapshots",
    group: "Alerts & events",
    data: { dryRun: true },
  },
  {
    id: "alerts-prune-snapshots",
    label: "Prune alert imagery (keep one a day)",
    description:
      "Apply alert-imagery retention for real: full-res inside the recent window, one still per alert + kind per UTC day beyond it, nothing past the hard cap except an aired alert's keepsake. Runs daily on its own; this button forces it. The alerts themselves are never deleted — only the pictures.",
    domain: "alerts",
    type: "alerts",
    event: "pruneSnapshots",
    group: "Alerts & events",
  },
  {
    id: "alerts-dedup-snapshots-dry",
    label: "Check duplicate alert imagery (dry run)",
    description:
      "Count byte-identical duplicate alert stills without deleting any. The hourly before/after comparison used to re-store the same image every hour for every alert, so the same picture is on disk many times over. Cheap: stills are grouped by size first, so anything with a unique size is never even opened. Read this before the real one.",
    domain: "alerts",
    type: "alerts",
    event: "dedupSnapshots",
    group: "Alerts & events",
    data: { dryRun: true },
  },
  {
    id: "alerts-dedup-snapshots",
    label: "Remove duplicate alert imagery",
    description:
      "Collapse byte-identical alert stills down to one copy, keeping the newest. Only exact duplicates of the same alert's same image kind are removed, so nothing you could tell apart by eye is lost. A one-off reclaim for what the old hourly comparison wrote; run it after the comparison fix is deployed.",
    domain: "alerts",
    type: "alerts",
    event: "dedupSnapshots",
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
    id: "seismic-archive-dry",
    label: "Check seismic archive (dry run)",
    description:
      "Count the earthquakes that WOULD be copied into the permanent record, writing nothing. The live quake collection expires after ~31 days (a TTL, right for the map, wrong for history), so anything not copied out is simply gone. Archiving keeps M4.5+ (QUAKE_ARCHIVE_MIN_MAG) forever — small documents, no imagery.",
    domain: "tracks",
    type: "tracks",
    event: "archiveSeismic",
    group: "Tracks",
    data: { dryRun: true },
  },
  {
    id: "seismic-archive",
    label: "Archive earthquakes (permanent record)",
    description:
      "Copy significant earthquakes out of the expiring live collection into the permanent seismic record. Runs daily on its own; this button forces it, and is also how you seed the record for the first time from whatever is still inside the 31-day window. Idempotent — re-running rewrites the same events and picks up USGS magnitude revisions.",
    domain: "tracks",
    type: "tracks",
    event: "archiveSeismic",
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
    id: "presenter-refresh-voices",
    label: "Refresh presenter voices",
    description:
      "Fetch OpenRouter's speech models, their voices and prices into the cache /admin/presenters reads. Run once before auditioning voices, and again when OpenRouter adds models.",
    domain: "presenter",
    type: "presenter",
    event: "refreshVoices",
    group: "Alerts & events",
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
  {
    id: "place-roundups-countries",
    label: "Country AI round-ups",
    description:
      "Generate an AI round-up for each round-up-enabled country — top-10 cities + capital conditions, area-weather, every active alert/volcano, and nearest tide/seismo gauges — continuing from the previous round-up. Scheduled at the local hours set on /admin/place-roundups (each country at its own local time); this button generates the whole set now. Enable countries on /countries.",
    domain: "placeRoundups",
    type: "placeRoundups",
    event: "generateCountries",
    group: "Alerts & events",
    priority: 5,
  },
  {
    id: "place-roundups-regions",
    label: "Region AI round-ups",
    description:
      "Generate an AI round-up for every region — top cities, area-weather, active alerts/volcanoes and nearest gauges — continuing from the previous round-up. Scheduled at the local hours set on /admin/place-roundups (each region at its own local time); this button generates the whole set now.",
    domain: "placeRoundups",
    type: "placeRoundups",
    event: "generateRegions",
    group: "Alerts & events",
    priority: 5,
  },
  ...CITY_JOBS,
  {
    id: "cities-backfill-loc",
    label: "Backfill city geo-index (loc)",
    description:
      "One-time: add the 2dsphere `loc` point to city docs seeded before the geo index existed, so in-view city lookups (nearby-event, area tours, climate warm) use the geospatial index instead of scanning the whole population index. Idempotent — skips cities that already have it. Reseeds set it automatically, so this only matters right after deploying the field.",
    domain: "cities",
    type: "cities",
    event: "backfillLoc",
    group: "Cities",
    priority: 5,
  },
  {
    id: "cities-backfill-timezones",
    label: "Backfill city timezones",
    description:
      "One-time: add the IANA timezone (\"Asia/Tokyo\") to city docs seeded before the field existed, by re-reading the GeoNames dump and matching on the geonames id already on every doc. Feeds the on-air LOCAL TIME row on country, alert, seismic and volcano cuts — without it those fall back to a longitude guess, which is wrong wherever a country's clock ignores its meridian (China, Spain, India's half hour). Pure field fill: nothing else on the doc is touched, so Wikipedia enrichment survives (a reseed would not). Idempotent — skips cities that already have one. Reads the finest GeoNames dump (a superset of every seed tier), so one run covers the collection however it was seeded.",
    domain: "cities",
    type: "cities",
    event: "backfillTimezones",
    group: "Cities",
    priority: 5,
  },
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
    description:
      "Fetch a Wikipedia photo/gallery + Wikidata facts for prominent cities (≥100k + capitals) in restartable batches of 100. Fresh cities are skipped. Use Stop to halt a run in progress.",
    domain: "cities",
    type: "cities",
    event: "enrichWikiAll",
    group: "Cities",
    priority: 10,
    data: { minPopulation: 100_000 },
    stoppable: true,
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
    id: "alert-geom-sync",
    label: "Resolve alert area boundaries",
    description:
      "Look up the real map shape for European warning areas. MeteoAlarm names an alert's area and gives it an EMMA code but no outline, so those alerts can't be drawn — this resolves each code to its boundary via MeteoGate and caches it for good. Also repairs cached shapes Mongo has rejected (a ring that touches itself can't be indexed, so \"which cities are under this\" comes back empty for it). Needs METROGATE_API_KEY. Safe to re-run: it only fetches areas it hasn't already resolved.",
    domain: "alertGeom",
    type: "alertGeom",
    event: "refresh",
    group: "Alerts & events",
  },
  {
    id: "admin-geom-nuts",
    label: "Import NUTS area boundaries",
    description:
      "Fetch the map shapes for France (NUTS3) and Hungary (NUTS2) warnings, which name their area by a standard NUTS code and ship no outline — so those alerts can't be drawn. Downloads the boundaries once from Eurostat GISCO (NUTS 2013, the vintage the feed actually uses), caches them for good, and retro-fits any stored alerts still missing a shape. Complements \"Resolve alert area boundaries\" (which does MeteoAlarm's EMMA codes). Safe to re-run; refreshes in place.",
    domain: "adminGeom",
    type: "adminGeom",
    event: "refresh",
    group: "Alerts & events",
  },
  {
    id: "admin-geom-gadm",
    label: "Import China area boundaries",
    description:
      "Fetch county map shapes for China's CMA warnings, which name their area (\"Jinghe County\") but ship no outline. 42% of CMA alerts already arrive with a polygon; this fills most of the rest by matching the English county name to a GADM boundary — only when the name is unambiguous, or a neighbouring warning pins which province it's in, so it never draws the wrong county. Downloads the boundaries once, caches them, and retro-fits stored alerts. NOTE: GADM is non-commercial and must not be redistributed — the data is fetched at import and only the shapes it resolves are kept; swap the source for an OSM county export before any commercial use. Safe to re-run.",
    domain: "adminGeom",
    type: "adminGeom",
    event: "refreshGadm",
    group: "Alerts & events",
  },
  {
    id: "alerts-population",
    label: "Recount people under alerts",
    description:
      "Recompute the \"people under this warning\" estimate for every active alert from scratch — the summed population of the catalogued cities inside each one's footprint. The scheduled reconcile already refreshes this incrementally whenever an alert's shape changes (a new bulletin, or a polygon backfilled), so this button is for the case that can't notice: the CITIES dataset changing underneath — a reseed, a denser tier, or the one-time city geo-index (loc) backfill (until that runs, every count reads zero). Cities-based ESTIMATE, not a census. Idempotent; safe to re-run. Heavy first pass (one indexed lookup per alert).",
    domain: "alerts",
    type: "alerts",
    event: "population",
    data: { force: true },
    group: "Alerts & events",
  },
  {
    id: "alert-blobs-rebuild",
    label: "Merge neighbouring alert areas",
    description:
      "Join up touching warning areas that share a hazard, a severity AND a country into single shapes, so the globe shows a few weather blobs instead of one square per county (MeteoAlarm issues one alert per county). A shape never crosses a national border — warnings are issued per country, and without that seam the merge chained clean across the continent. Also strips the hairline gaps left where two counties' borders don't quite meet, which the globe would otherwise draw as streaks. This button re-dissolves EVERYTHING from scratch (the scheduled job only re-merges buckets whose alerts actually changed) — use it after a code/config change to the dissolve, or when a shape looks wrong. The alerts themselves are untouched and panels still list them individually. Safe to re-run, and safe while the globe is live: the new set is only swapped in once it's complete.",
    domain: "alertBlobs",
    type: "alertBlobs",
    event: "refresh",
    data: { force: true },
    group: "Alerts & events",
  },
  {
    id: "alert-capid-sync",
    label: "Resolve alert CAP ids",
    description:
      "Look up the original CAP identifier behind each WMO alert. WMO leaves that id blank, so the same storm arriving from both WMO and MeteoAlarm can't be recognised as one warning — this resolves it and caches it permanently, which is what lets the two sources be merged. Safe to re-run: it only fetches alerts it hasn't already resolved.",
    domain: "alertCapId",
    type: "alertCapId",
    event: "refresh",
    group: "Alerts & events",
  },
  {
    id: "elevation-bake",
    label: "Bake elevation relief",
    description:
      "Download ETOPO 2022 terrain + ocean-floor bathymetry and bake the static elevation contour texture (~466 MB download, one-time; drives the Relief basemap and the Terrain → Elevation contours overlay). Reuses the published run when its texture is still readable, and re-bakes automatically when the bytes have gone.",
    domain: "elevation",
    type: "elevation",
    event: "refresh",
    group: "Static datasets",
  },
  {
    // Same handler, `force` preset: bakes even when a good published run exists.
    // Needed after a bake-resolution change (ELEVATION_BAKE_WIDTH/HEIGHT) or a
    // swapped DEM, where the existing texture is readable but no longer what we
    // want — the plain button would reuse it forever.
    id: "elevation-bake-force",
    label: "Re-bake elevation relief (force)",
    description:
      "Re-bake the static elevation relief texture even though a published run already exists — for a changed bake resolution or a swapped DEM. Slow: re-reads the cached ~466 MB ETOPO GeoTIFF and re-encodes the PNG.",
    domain: "elevation",
    type: "elevation",
    event: "refresh",
    group: "Static datasets",
    data: { force: true },
  },
  {
    id: "volcanoes-snapshot",
    label: "Refresh active volcanoes",
    description: "Re-pull the Smithsonian/USGS Weekly Volcanic Activity Report into Mongo now.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "snapshot",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-enrich",
    label: "Enrich volcanoes (Wikipedia)",
    description:
      "Fetch a Wikipedia photo/gallery + Wikidata facts (elevation, type, last eruption) for each active volcano. Fresh ones (< 30 days) are skipped.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "enrichWiki",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-parse-reports",
    label: "Parse volcano bulletins (LLM)",
    description:
      "LLM-parse each volcano's weekly bulletin text for plume height/VEI. Requires OPENROUTER_API_KEY; no-ops without it.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "parseReports",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-snapshot-usgs",
    label: "Refresh USGS volcano alerts",
    description: "Re-pull the USGS VHP status GeoJSON (all US-monitored volcanoes; catches de-escalations to NORMAL).",
    domain: "volcanoes",
    type: "volcanoes",
    event: "snapshotUsgs",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-snapshot-geonet",
    label: "Refresh GeoNet volcano alerts",
    description: "Re-pull GeoNet's official NZ Volcanic Alert Levels and crosswalk them onto our volcanoes.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "snapshotGeonet",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-geonet-cams",
    label: "Refresh GeoNet volcano cameras",
    description: "Re-pull GeoNet's official volcano camera catalogue and tag each with its volcano.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "ingestGeonetCams",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-snapshot-cams",
    label: "Capture volcano camera frames",
    description:
      "Archive one still per active-volcano camera (the 'earlier today / this week' history). Skips flat dark night frames but keeps night incandescence; dedups unchanged frames. Needs VOLCANO_CAM_SNAPSHOT_ENABLED=true + EVENTS_UNIFIED_ENABLED=true.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "snapshotCams",
    group: "Volcanoes",
  },
  {
    id: "volcano-media-registry",
    label: "Discover volcano media cameras",
    description: "Refresh official volcano-specific camera registries (AVO first; additional adapters share the same storage).",
    domain: "volcanoes",
    type: "volcanoes",
    event: "mediaRegistry",
    group: "Volcanoes",
  },
  {
    id: "volcano-camera-refresh",
    label: "Acquire volcano camera media",
    description: "Download changed official camera images into the shared blob store and retain source/rights metadata.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "cameraRefresh",
    group: "Volcanoes",
  },
  {
    id: "volcano-official-media",
    label: "Acquire official volcano media",
    description: "Discover and archive official eruption photographs, monitoring graphics and other non-camera media.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "officialMedia",
    group: "Volcanoes",
  },
  {
    id: "volcano-satellite-media",
    label: "Acquire volcano satellite media",
    description: "Discover and archive volcano-specific VOLCAT satellite/thermal products for active volcanoes.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "satelliteMedia",
    group: "Volcanoes",
  },
  {
    id: "volcano-media-rights",
    label: "Audit volcano media rights",
    description: "Summarise archived volcano media by licence and automatic-reuse status; VERIFY items remain blocked.",
    domain: "volcanoes",
    type: "volcanoes",
    event: "mediaRights",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-timelapse-cams",
    label: "Build volcano camera timelapse",
    description: "Stitch each active-volcano camera's archived frames into a looping WebP timelapse (stored + served like any snapshot).",
    domain: "volcanoes",
    type: "volcanoes",
    event: "timelapseCams",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-prune-cams",
    label: "Prune old volcano camera frames",
    description: "Drop captured volcano camera frames + timelapses past the retention window (default 30 days).",
    domain: "volcanoes",
    type: "volcanoes",
    event: "pruneCamSnapshots",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-purge-orphan-cams-dry",
    label: "Check orphaned volcano cameras (dry run)",
    description:
      "Count the volcano cameras the registries no longer discover (status offline) WITHOUT deleting anything — e.g. the hundreds of dead INGV rows named after a relative archive path (`../../Dati/webcams/...`), left behind when that adapter minted an id per archived frame before it was fixed. Look here first, then run the purge.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "purgeOrphanCams",
    group: "Volcanoes",
    data: { dryRun: true },
  },
  {
    id: "volcanoes-purge-orphan-cams",
    label: "Purge orphaned volcano cameras",
    description:
      "Delete volcano cameras the registries no longer discover (status offline). Self-healing: a camera that comes back is re-added by the next discovery sweep. Run the dry run first — a registry outage marks a provider's whole catalog offline, and purging then would drop live cameras.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "purgeOrphanCams",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-migrate-catalog",
    label: "1. Migrate volcanoes → permanent catalog (run once)",
    description:
      "ONE-OFF: drop the 14-day TTL so volcanoes stop auto-deleting when they leave the weekly bulletin, and backfill `bulletinAt`. Inactive volcanoes keep their stats forever. MUST be run before seeding the full catalog — otherwise every seeded volcano silently expires 14 days later. Safe to re-run.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "migrate",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-seed-catalog",
    label: "2. Seed ALL volcanoes (GVP catalog)",
    description:
      "Add every Smithsonian GVP volcano (~1,196 Holocene) with its full dossier: volcano type, landform, tectonic setting, epoch, rock types, region, GVP's geology write-up and primary photo. Set VOLCANO_INCLUDE_PLEISTOCENE=true to also add the ~1,451 Pleistocene ones. Never resets live status or wipes enrichment — safe to re-run. Run the migration first.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "seed",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-seed-eruptions",
    label: "3. Seed eruption history (GVP)",
    description:
      "Add the full GVP eruption history (~11,089 eruptions with VEI + dates back to 55,500 BCE) for every volcano — powers \"last erupted\" and the eruption timeline. Safe to re-run.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "seedEruptions",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-prune-media-dry",
    label: "Check volcano camera frame backlog (dry run)",
    description:
      "Count the superseded camera frames stacked up in volcano media WITHOUT deleting anything. Camera refresh used to keep every distinct frame forever (~300 cameras × a poll every 5 minutes, nothing ever pruned); it now keeps only the latest frame per camera. This reports the backlog that built up before that. Look here first.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "pruneMediaDryRun",
    group: "Volcanoes",
  },
  {
    id: "volcanoes-prune-media",
    label: "Prune volcano camera frames to latest only",
    description:
      "Delete every camera frame except the newest per camera, and their blobs on disk. Cameras show what a volcano looks like RIGHT NOW, so older frames are dead weight. Published photos (GVP/Wikimedia/NASA/IMO eruption stills) are NOT touched — only camera frames. Safe to re-run; runs daily as a backstop.",
    domain: "volcanoes",
    type: "volcanoCatalog",
    event: "pruneMedia",
    group: "Volcanoes",
  },
  {
    id: "countries-seed",
    label: "Reseed country catalog",
    description: "Rebuild the ~240-country catalog (name/iso codes/continent/boundary) from the bundled Natural Earth GeoJSON.",
    domain: "countries",
    type: "countries",
    event: "seed",
    group: "Countries & Regions",
  },
  {
    id: "countries-enrich",
    label: "Enrich countries (Wikipedia)",
    description: "Fetch a Wikipedia photo/blurb + Wikidata population/capital/currency for each country. Fresh ones (< 30 days) are skipped.",
    domain: "countries",
    type: "countries",
    event: "enrichWiki",
    group: "Countries & Regions",
  },
  {
    id: "countries-tours",
    label: "Compute country tours",
    description: "Recompute each country's spotlight camera tour (population-weighted centre + biggest city per compass sector) from its own cities. Run after seeding countries & cities.",
    domain: "countries",
    type: "countries",
    event: "computeTours",
    group: "Countries & Regions",
  },
  {
    id: "regions-seed",
    label: "Reseed region catalog",
    description: "Rebuild the region catalog (oceans/continents/EU blocs/UK nations) from the curated preset list.",
    domain: "regions",
    type: "regions",
    event: "seed",
    group: "Countries & Regions",
  },
  {
    id: "regions-enrich",
    label: "Enrich regions (Wikipedia)",
    description: "Fetch a Wikipedia photo/blurb for each region. Fresh ones (< 30 days) are skipped.",
    domain: "regions",
    type: "regions",
    event: "enrichWiki",
    group: "Countries & Regions",
  },
  {
    id: "regions-places",
    label: "Rebuild region places",
    description: "Recompute each land region's member countries + biggest cities from the curated relations. Run after seeding countries & cities.",
    domain: "regions",
    type: "regions",
    event: "enrichPlaces",
    group: "Countries & Regions",
  },
  {
    id: "city-weather-refresh",
    label: "Refresh city weather cache",
    description: "Sample the frame archive + forecast at every city ≥100k and cache 24h trend + current + 3-day forecast.",
    domain: "regions",
    type: "cityWeather",
    event: "refresh",
    group: "Countries & Regions",
  },
  {
    id: "area-weather-run",
    label: "Refresh area-weather reports",
    description: "Snapshot mean/min/max temp/gust/rain + hazard flags for every country (real boundary) and region (bbox) right now.",
    domain: "areaWeather",
    type: "areaWeather",
    event: "run",
    group: "Countries & Regions",
  },
  ...SHORT_VIDEO_JOBS,
];

export const getTriggerableJob = (id: string): TriggerableJob | undefined =>
  TRIGGERABLE_JOBS.find((j) => j.id === id);
