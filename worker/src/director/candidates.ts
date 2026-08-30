/**
 * Build the scored candidate pool the director picks from each cut. Live events
 * (earthquakes, severe-weather alerts, notable flights/ships) come from the same
 * Mongo caches the public overlays read; curated establishing shots (the intro
 * opener + recurring global/ocean spins + country spotlights) are always added as
 * filler so the channel never runs out of somewhere to look.
 *
 * Pure-ish: takes a DB facade + config, returns Candidates. Scoring lives here
 * so "what's newsworthy" is one readable place to tune.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  kindHoldMs,
  quakeHoldMs,
  stormHoldMs,
  volcanoHoldMs,
  type DirectorConfig,
  type Segment,
  type SegmentKind,
  type SegmentSummaryStop,
  type TrackInfo,
} from "@photonsurge/shared/director";
import { coarseGeoCell, type Candidate } from "@photonsurge/shared/director-select";
import { DEFAULT_WIND_SETTINGS } from "@photonsurge/shared/control";
import { vehicleId, vehicleLabel, type iVehicle } from "@photonsurge/shared/db/vehicle-model";
import type { iRegionCity } from "@photonsurge/shared/db/region-model";
import {
  PRESETS,
  ROUNDUP_MARKERS,
  GLOBAL_VIEW,
  OCEAN_VIEW_ZOOM,
  globalMapTour,
  ORBITAL_VIEW_ZOOM,
  ORBITAL_VIEWS,
} from "@photonsurge/shared/director-rois";
import { countryShot, type CountryShot } from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";
import { adMediaPath } from "@photonsurge/shared/ads/types";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { quakeSegmentContent, alertSegmentContent, volcanoSegmentContent, volcanoTrackInfo } from "@photonsurge/shared/segments";
import { discLookFeeds, type SatImgFeedState } from "@photonsurge/shared/satimg/types";
import { mmsiCountry, countryNameFlag } from "@photonsurge/shared/tracks/flags";
import type { SummaryPeriod, iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";
import { tleGroups } from "../jobs/tracks";
import { volcanoStatusToSeverity } from "../summaries/aggregate";

const make = (
  kind: SegmentKind,
  subject: string,
  title: string,
  subtitle: string | undefined,
  center: [number, number],
  zoom: number,
  holdMs: number,
  cfg: DirectorConfig,
  /** Extra per-segment ControlState (e.g. ocean shots set their own variable). */
  extra?: Partial<Segment["patch"]>,
): Segment => {
  // Operator per-kind look (DirectorConfig.kindLooks) — basemap/wind, applied
  // self-contained against defaults (not whatever's live) so a kind's look is
  // deterministic regardless of what the previous cut left behind.
  const look = cfg.kindLooks?.[kind];
  return {
    id: `${kind}:${subject}`,
    kind,
    title,
    subtitle,
    camera: { center, zoom },
    // Operator overlay overrides (DirectorConfig.overlayOverrides) layer onto the
    // kind's preset but never beat `extra` — a segment's own computed fields
    // (activeVariable, satelliteGroup, …) always win.
    patch: {
      ...PRESETS[kind],
      ...cfg.overlayOverrides?.[kind],
      ...(look?.basemap ? { basemap: look.basemap } : {}),
      ...(look?.windMode ? { windMode: look.windMode } : {}),
      ...(look?.wind ? { wind: { ...DEFAULT_WIND_SETTINGS, ...look.wind } } : {}),
      // Per-kind satellite look: force the overlay on/off, and set every disc's
      // composite so an on disc flips to this shot's look (see discLookFeeds).
      ...(look?.showSatImg != null ? { showSatImg: look.showSatImg } : {}),
      ...(look?.satImgLook ? { satImgFeeds: discLookFeeds(look.satImgLook) } : {}),
      // A saved slide's full per-feed snapshot (on/opacity/look) is more specific
      // than the single-look shortcut above, so it wins when both are present.
      ...(look?.satImgFeeds ? { satImgFeeds: look.satImgFeeds as Record<string, SatImgFeedState> } : {}),
      // The kind's own computed variable (weather/ocean cycle client-side, storm
      // sets "gust" in PRESETS) always wins via `extra` below; this only fills in
      // for kinds that don't compute one themselves.
      ...(look?.activeVariable ? { activeVariable: look.activeVariable } : {}),
      ...(look?.auroraOpacity != null ? { auroraOpacity: look.auroraOpacity } : {}),
      ...(look?.magneticFieldOpacity != null ? { magneticFieldOpacity: look.magneticFieldOpacity } : {}),
      ...extra,
      camera: { center, zoom },
    },
    holdMs,
  };
};

type Detail = { label: string; value: string };

/** Score for the two tiers of catalogued (enriched) craft — a plain notable clears
 *  the fillers, a VIP (Air Force One) tops them. Kept below severe-weather/quake
 *  headlines — tunable later; the data drives it. Only catalogued craft ever reach
 *  the flight/ship pool (see buildCandidates), so every candidate gets one of these. */
const NOTABLE_SCORE = 45;
const VIP_SCORE = 80;

/**
 * How recent a quake/storm has to be to jump the priority-preempt tier
 * (`selectPriority`). `db.quakes.list`/`db.alerts.list` return the top N by
 * magnitude/severity with no time cutoff, so right after a session starts (or
 * the worker restarts) most of that backlog is "unaired" — without this window
 * every one of them would preempt fair rotation in turn, and the show would
 * play nothing but quakes/storms until the whole backlog finally airs once.
 */
const BREAKING_NEWS_WINDOW_MS = 20 * 60 * 1000;

/**
 * Volcanoes get their own, much wider breaking-news window: the source is a
 * *weekly* bulletin (polled every 30 min), so there's no per-event "it just
 * happened" timestamp the way a quake or alert has — the best signal available
 * is `statusChangedAt`, when OUR cache last saw the status actually flip (see
 * volcano-repo.ts's pipeline-update upsert). A few hours gives that transition
 * room to surface across a couple of poll cycles without staying "breaking"
 * for the volcano's entire multi-week eruption.
 */
const VOLCANO_BREAKING_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Frame zoom mirrors the manual click-to-select path (see public/lib/select-segment.ts). */
const VOLCANO_ZOOM = 5;

/** How many severe-weather candidates the storm pool holds at most. */
const ALERT_POOL_CAP = 40;
/** How deep into the globally severity-ranked alert list we scan to fill it. */
const ALERT_SCAN_LIMIT = 300;
/**
 * Per-country storm-candidate cap. `db.alerts.list` ranks by severity then
 * recency GLOBALLY, so one prolific met service can outnumber the whole pool
 * cap by itself (live incident: Kazhydromet ran 66 simultaneous sev-4 warnings
 * — the top-40 slice came back 36× Kazakhstan and rotation could only
 * ping-pong between it and the four other alerts that squeezed in, while every
 * lower-severity country never became a candidate at all). Walking the ranked
 * list and keeping at most this many per country preserves "biggest stories
 * first" while letting the rest of the world on air.
 */
const ALERT_COUNTRY_CAP = 3;

/**
 * Merge a notable catalog entry with the live meta into the on-air TrackInfo card
 * payload. Operator overrides win; catalog values win over live gap-fills.
 */
function notableTrackInfo(
  n: iVehicle,
  live: { type?: string; operator?: string; registration?: string; flag?: string; country?: string },
): TrackInfo {
  const override = n.photoUrlOverride?.trim();
  return {
    label: vehicleLabel(n),
    category: n.category,
    photoUrl: override || n.photoUrl,
    photoCredit: override ? undefined : n.photoCredit,
    photoLink: override ? undefined : n.photoLink,
    manufacturer: n.manufacturer,
    type: n.type || live.type,
    operator: n.operator || live.operator,
    registration: n.registration || live.registration,
    flag: n.flag || live.flag,
    country: n.country || live.country,
    extract: n.blurbOverride?.trim() || n.wikiExtract,
    notable: true,
    vip: Boolean(n.vip),
  };
}

/**
 * Curated filler: the one-time intro opener + the recurring global spin (same
 * world map-type tour) + the ocean spin + operator-favourite country spotlights.
 */
function fillerCandidates(cfg: DirectorConfig): Candidate[] {
  const out: Candidate[] = [];
  if (cfg.kinds.intro) {
    // The session opener — selectNext only airs it on the very first cut, then
    // retires it (see director-select). Still built every tick so that cut has it.
    out.push({
      score: 6,
      segment: make("intro", "global", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, kindHoldMs(cfg, "intro"), cfg),
    });
  }
  if (cfg.kinds.global) {
    // The recurring world spin — identical look to the intro opener (it tours the
    // same INTRO_MAP_TYPES client-side), just aired as ordinary global filler.
    out.push({
      score: 6,
      segment: make("global", "world", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, kindHoldMs(cfg, "global"), cfg),
    });
  }
  if (cfg.kinds.ocean) {
    // One global ocean spin that TOURS the ingested ocean fields (SST → swell →
    // salinity) within the shot, instead of a separate cut per field. It opens on
    // the first map type (SST); the client (useDirectorCut) rotates + relabels the
    // rest on the spin clock and drops any field that isn't ingested.
    out.push({
      score: 6,
      segment: make(
        "ocean",
        "world",
        "Ocean Conditions",
        "Sea surface & swell",
        GLOBAL_VIEW.center,
        OCEAN_VIEW_ZOOM,
        kindHoldMs(cfg, "ocean"),
        cfg,
        { activeVariable: globalMapTour("ocean", cfg.mapTypes.ocean)?.[0]?.patch.activeVariable ?? "sst" },
      ),
    });
  }
  if (cfg.kinds.orbital) {
    // Only air constellations whose TLEs the worker actually ingests
    // (SATELLITE_GROUPS), so an orbital shot is never empty.
    const ingested = new Set(tleGroups());
    for (const view of ORBITAL_VIEWS) {
      if (!ingested.has(view.group)) continue;
      out.push({
        score: 6,
        segment: make(
          "orbital",
          view.group,
          view.title,
          view.subtitle,
          GLOBAL_VIEW.center,
          view.zoom ?? ORBITAL_VIEW_ZOOM,
          kindHoldMs(cfg, "orbital"),
          cfg,
          { satelliteGroup: view.group },
        ),
      });
    }
  }
  // Country ("national") + Region ("area") spotlights both need a DB read now —
  // their tour stops come from the precomputed city dossiers — so they're built
  // in the async countryCandidates / regionCandidates below, not here.
  return out;
}

/** How many stops a country spotlight tours at most (the establishing centre
 *  shot + one city per compass sector). Sized so the hold stays a few minutes. */
const COUNTRY_TOUR_STOPS = 8;

/**
 * The camera stops a `country` spotlight tours — the country's OWN cities, from
 * the precomputed `tourCities` dossier (worker `countries.computeTours`, scoped
 * by `cc`, spread one-per-compass-sector). The tour OPENS on a wide establishing
 * "middle of the country" stop (the population-weighted centroid at the frame
 * zoom) so it reads as "here's the nation" before sweeping its cities. Empty when
 * the country hasn't been computed yet — the caller then airs one framed
 * spotlight instead. The whole country glows throughout (activeCountryIso keys
 * `country` shots off the curated ISO), so stops don't need per-stop glow.
 */
function countryTourStops(doc: iCountryModel, shot: CountryShot): SegmentSummaryStop[] {
  const cities = doc.tourCities ?? [];
  if (!cities.length) return [];
  const iso2 = shot.iso2 || doc.iso2 || undefined;
  const stops: SegmentSummaryStop[] = [];
  // Establishing wide shot the tour starts on — "start in the middle".
  if (doc.tourCentroid && doc.tourFrame) {
    stops.push({
      label: shot.name,
      subtitle: "National weather",
      lng: doc.tourCentroid[0],
      lat: doc.tourCentroid[1],
      zoom: doc.tourFrame.zoom,
      iso2,
    });
  }
  for (const c of cities.slice(0, COUNTRY_TOUR_STOPS - stops.length)) {
    stops.push({ label: c.name, subtitle: shot.name, lng: c.lng, lat: c.lat, iso2 });
  }
  return stops;
}

/**
 * Operator-favourite country spotlights. Each airs as a "go round the nation"
 * tour when its precomputed `tourCities` dossier exists (the client flies the
 * camera to each city, showing its weather), else falls back to the curated
 * single framed shot — so a country the tour job hasn't reached yet still airs,
 * exactly as before. Unknown ids (stale config) are skipped. Mirrors
 * regionCandidates.
 */
async function countryCandidates(db: AppDb, cfg: DirectorConfig): Promise<Candidate[]> {
  if (!cfg.kinds.country) return [];
  const out: Candidate[] = [];
  const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
  for (const id of cfg.countries) {
    const shot = countryShot(id);
    if (!shot) continue;
    // The computed dossier lives on the Country doc keyed by iso2-lowercased.
    // A missing/erroring catalog just means the curated fallback shot — fillers
    // must never throw the show off the air.
    let doc: iCountryModel | null = null;
    try {
      doc = await db.countries.get(shot.iso2.toLowerCase());
    } catch {
      doc = null;
    }
    const stops = doc ? countryTourStops(doc, shot) : [];
    // Frame on the computed tour frame when we have one, else the curated shot.
    const center = doc?.tourFrame?.center ?? shot.center;
    const zoom = doc?.tourFrame?.zoom ?? shot.zoom;
    // Size the hold to fly every stop (flight + dwell), floored by the operator's
    // per-kind minimum — no cap, or the tour cuts away mid-way (as region does).
    const holdMs = stops.length
      ? Math.max(kindHoldMs(cfg, "country"), stops.length * (transitionMs + SUMMARY_STOP_DWELL_MS))
      : kindHoldMs(cfg, "country");
    const subtitle = stops.length ? "Country tour · National weather" : "Country spotlight · National weather";
    const seg = make("country", shot.id, shot.name, subtitle, center, zoom, holdMs, cfg);
    seg.icon = shot.flag;
    if (stops.length) seg.tourStops = stops;
    out.push({ score: 6, segment: seg });
  }
  return out;
}

/** How many COUNTRIES an area tour visits at most. The region hold is sized to
 *  cover every stop (unlike a round-up, which caps toured stops at
 *  SUMMARY_MAX_TOUR_STOPS). */
const REGION_TOUR_STOPS = 10;

/**
 * The camera stops an area tour visits: the area's TOP COUNTRIES — never cities.
 * Derived from the CURATED `topCities` dossier on the Region doc
 * (regions.enrichPlaces), which is scoped to the region's MEMBER COUNTRIES
 * (region-membership) so it never bleeds across the bounding box into neighbours
 * the way a raw lat/lng query would. We group those cities by country, rank the
 * countries by their in-region presence (summed city population), and emit ONE
 * stop per country — captioned by the COUNTRY, framed on the country's main
 * population centre (its biggest in-region city's coords, since the dossier
 * carries no country centroid), and tagged with the ISO so the globe glows that
 * exact country. Capped at REGION_TOUR_STOPS countries, biggest-presence first.
 *
 * A single-country area (the UK, a US band) has no "top countries" to fly, so it
 * returns [] and the caller airs it as one framed whole-area spotlight rather than
 * zooming into a lone city. Also [] when the region has no cached cities (not yet
 * enriched).
 */
async function regionTourStops(db: AppDb, regionId: string): Promise<SegmentSummaryStop[]> {
  const region = await db.regions.get(regionId);
  const cities = region?.topCities ?? [];
  if (!cities.length) return [];
  // Group the (already population-ranked) cities by country, preserving that
  // order within each country so list[0] is the country's biggest city — the
  // point we frame as that country's stop.
  const byCountry = new Map<string, iRegionCity[]>();
  for (const c of cities) {
    const key = (c.cc || c.country || "").toLowerCase();
    if (!key) continue;
    const arr = byCountry.get(key);
    if (arr) arr.push(c);
    else byCountry.set(key, [c]);
  }
  const sumPop = (list: iRegionCity[]) => list.reduce((s, c) => s + (c.population ?? 0), 0);
  const countries = [...byCountry.values()].sort((a, b) => sumPop(b) - sumPop(a));
  // Single-country area → no country tour to fly; air it as one framed spotlight.
  if (countries.length <= 1) return [];
  return countries.slice(0, REGION_TOUR_STOPS).map((list): SegmentSummaryStop => {
    const c = list[0];
    return {
      label: c.country || (c.cc ? c.cc.toUpperCase() : c.name),
      lng: c.lng,
      lat: c.lat,
      iso2: c.cc ? c.cc.toUpperCase() : undefined,
    };
  });
}

/**
 * Operator-favourite Areas. Each airs as the "go round a place" tour when its
 * bbox has cached cities (the client flies the camera to each, showing its
 * weather), else falls back to a single framed spotlight. Camera framing is
 * derived from the region bbox (see director-regions); unknown ids are skipped.
 */
async function regionCandidates(db: AppDb, cfg: DirectorConfig): Promise<Candidate[]> {
  if (!cfg.kinds.region) return [];
  const out: Candidate[] = [];
  const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
  for (const id of cfg.regions) {
    const r = regionShot(id);
    if (!r) continue;
    const stops = await regionTourStops(db, r.id);
    // Size the hold to fly EVERY city (flight + dwell each), floored by the
    // operator's per-kind minimum — no SUMMARY_MAX_TOUR_STOPS cap here, or the
    // tour would cut away mid-way through the later cities.
    const holdMs = stops.length
      ? Math.max(kindHoldMs(cfg, "region"), stops.length * (transitionMs + SUMMARY_STOP_DWELL_MS))
      : kindHoldMs(cfg, "region");
    const subtitle = stops.length ? "Area tour · Regional weather" : "Region spotlight · Regional weather";
    const seg = make("region", r.id, r.name, subtitle, r.center, r.zoom, holdMs, cfg);
    if (stops.length) seg.tourStops = stops;
    out.push({ score: 6, segment: seg });
  }
  return out;
}

/**
 * Build a full-frame ad interstitial, or null when no active ad exists. Unlike
 * the other kinds this doesn't go through the scored pool — the loop injects it
 * on a fixed cadence (adEveryNShots), so we pick the ad here directly, rotating
 * through every active ad before any repeats. The globe is covered by the ad
 * card, so the camera just holds where the previous shot left it and no layers
 * change.
 */
export async function buildAdSegment(
  db: AppDb,
  cfg: DirectorConfig,
  prevCamera?: Segment["camera"],
  excludeAdId?: string,
): Promise<Segment | null> {
  const ad = await db.ads.pickForAir(undefined, excludeAdId);
  if (!ad) return null;
  const camera = prevCamera ?? { center: GLOBAL_VIEW.center, zoom: GLOBAL_VIEW.zoom };
  return {
    id: `ad:${ad.adId}`,
    kind: "ad",
    title: ad.title,
    subtitle: ad.advertiser,
    camera,
    patch: { camera },
    holdMs: kindHoldMs(cfg, "ad"),
    ad: {
      adId: ad.adId,
      title: ad.title,
      mediaType: ad.mediaType,
      mediaUrl: adMediaPath(ad.adId, ad.updatedAt),
      advertiser: ad.advertiser,
      clickUrl: ad.clickUrl,
    },
  };
}

const SUMMARY_PERIODS: { period: SummaryPeriod; label: string; staleAfterMs: number }[] = [
  { period: "hourly", label: "Hourly round-up", staleAfterMs: 3 * 60 * 60 * 1000 },
  { period: "12h", label: "12-hour round-up", staleAfterMs: 36 * 60 * 60 * 1000 },
  { period: "daily", label: "Daily round-up", staleAfterMs: 3 * 24 * 60 * 60 * 1000 },
];

/** Ticker reading speed — scrolling text reads faster than spoken narration. */
const SUMMARY_WORDS_PER_MIN = 170;
/** Narration-length cap for a STOP-LESS round-up (nothing to tour → just read). */
const SUMMARY_MAX_HOLD_MS = 60_000;
/**
 * Dwell per toured stop — MUST track `SUMMARY_STOP_DWELL_MS` in
 * public/src/lib/director.ts, which parks the camera on each stop ~40s to play
 * that country's left-column package (nation → forecast → alerts → cities →
 * stats). The hold below sizes the segment to cover the tour so it isn't cut
 * mid-package.
 */
const SUMMARY_STOP_DWELL_MS = 40_000;
/**
 * Editorial segment-length guardrail: at ~40s/country, size the hold to cover at
 * most this many stops so one round-up can't monopolise the channel for many
 * minutes. Tunable. (A dedupe-by-country pass would make each slot a distinct
 * nation; today the stops are hotspots-then-top-events, already fairly spread.)
 */
const SUMMARY_MAX_TOUR_STOPS = 6;

/**
 * How long a round-up holds on air. With geocoded stops it DWELLS — the camera
 * parks on each for ~(flight + dwell), playing that country's package deck — so
 * the hold must clear the whole tour, NOT the ≤60s narration cap (which would
 * cut the tour off after the first country). A stop-less round-up keeps the
 * old narration-length hold, floored by the operator's per-kind minimum.
 */
export function summaryTourHoldMs(
  stopCount: number,
  transitionMs: number,
  narrationMs: number,
  floorMs: number,
): number {
  if (stopCount <= 0) return Math.min(SUMMARY_MAX_HOLD_MS, Math.max(floorMs, narrationMs));
  const toured = Math.min(stopCount, SUMMARY_MAX_TOUR_STOPS);
  return Math.max(floorMs, narrationMs, toured * (transitionMs + SUMMARY_STOP_DWELL_MS));
}

/**
 * The places a round-up's camera tours while its narrative plays — the doc's
 * geographic hotspot clusters (broad sweep) followed by its named top events
 * (the specific warnings/quakes the narrative calls out), each carrying enough
 * to render an on-air info card (place, hazard/count, severity).
 */
function summaryStops(doc: iEventSummaryModel): SegmentSummaryStop[] {
  const stops: SegmentSummaryStop[] = (doc.hotspots ?? []).map((h) => ({
    label: h.label,
    subtitle: [h.hazards[0], h.count > 1 ? `${h.count} events` : undefined].filter(Boolean).join(" · ") || undefined,
    lng: h.lng,
    lat: h.lat,
    severity: h.maxSeverity,
  }));
  for (const e of doc.topEvents ?? []) {
    if (e.lng == null || e.lat == null) continue;
    stops.push({ label: e.title, subtitle: e.hazard, lng: e.lng, lat: e.lat, severity: e.severity });
  }
  return stops;
}

/**
 * One round-up candidate per period whose latest EventSummary has a real
 * narrative, hasn't already aired this session (`seenCounts`), and isn't stale
 * (the director was off for a while and the round-up is no longer "current").
 *
 * A round-up rides on the recurring `global` world spin — the spin BECOMES the
 * round-up: it tours the doc's hotspot stops with the narrative + stats shown as
 * on-air graphics (see the client's `cutSteps` / mode-slides `segment.summary`
 * branch), instead of the plain map-type cycle. The event-marker overlays
 * (ROUNDUP_MARKERS) are layered on so the seismic/alert/volcano markers behind
 * the story are lit. The stable id `global:<docid>` (unique per round-up doc) is
 * what makes fair rotation air each fresh round-up once before repeating, exactly
 * like any other `global` item.
 */
async function summaryCandidates(
  db: AppDb,
  cfg: DirectorConfig,
  seenCounts?: Map<string, number>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const now = Date.now();
  for (const { period, label, staleAfterMs } of SUMMARY_PERIODS) {
    let doc;
    try {
      doc = await db.eventSummaries.latest(period);
    } catch {
      continue; // not ingested yet — skip
    }
    if (!doc || doc.narrativeStatus !== "ok" || !doc.narrative.trim()) continue;
    const id = `global:${doc.id}`;
    if (seenCounts?.get(id)) continue; // already aired this session
    if (now - new Date(doc.generatedAt).getTime() > staleAfterMs) continue;

    const words = doc.narrative.trim().split(/\s+/).length;
    const narrationMs = Math.round((words / SUMMARY_WORDS_PER_MIN) * 60_000);
    const stops = summaryStops(doc);
    const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
    const holdMs = summaryTourHoldMs(stops.length, transitionMs, narrationMs, kindHoldMs(cfg, "global"));
    // The round-up rides a `global` spin (id → `global:<docid>`) with the
    // event markers layered on so the story's quakes/alerts/volcanoes show.
    const seg = make("global", doc.id, "Global Round-Up", label, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, holdMs, cfg, ROUNDUP_MARKERS);
    seg.summary = {
      id: doc.id,
      period,
      narrative: doc.narrative,
      generatedAt: doc.generatedAt instanceof Date ? doc.generatedAt.toISOString() : String(doc.generatedAt),
      stops,
      stats: doc.stats,
      sources: doc.sources,
    };
    out.push({ score: 8, segment: seg });
  }
  return out;
}

export async function buildCandidates(
  db: AppDb,
  cfg: DirectorConfig,
  seenCounts?: Map<string, number>,
): Promise<Candidate[]> {
  const pool: Candidate[] = fillerCandidates(cfg);
  const now = Date.now();
  // Round-ups ride the recurring global spin, so they only make sense when the
  // `global` kind is airing at all.
  if (cfg.kinds.global) pool.push(...(await summaryCandidates(db, cfg, seenCounts)));

  // Country spotlights (national tours) + Areas (region tours) — each favourite
  // flies round its precomputed biggest cities.
  pool.push(...(await countryCandidates(db, cfg)));
  pool.push(...(await regionCandidates(db, cfg)));

  // Notable-tracks catalog (enabled) — matched by `${kind}:${code}` to boost the
  // genuinely interesting craft onto air and hang the on-air Track Info card off
  // them. Loaded once; only when a track kind is eligible so we skip the query.
  let notableByKey = new Map<string, iVehicle>();
  if (cfg.kinds.flight || cfg.kinds.ship) {
    const cat = await db.vehicles.notableCatalog();
    notableByKey = new Map(cat.map((n) => [vehicleId(n.kind, n.code), n]));
  }

  // --- Earthquakes: magnitude is the headline; recent + big ranks highest. ---
  if (cfg.kinds.quake) {
    try {
      const quakes = await db.quakes.list({ minMag: cfg.minQuakeMag, limit: 40 });
      for (const q of quakes) {
        const c = quakeSegmentContent({
          mag: q.mag,
          place: q.place,
          depthKm: q.depthKm,
          timeMs: q.time ? q.time.getTime() : undefined,
          tsunami: q.tsunami,
        });
        // Quakes are geophysical — the shot reads as terrain (dark base +
        // elevation contours + faults/cables), not a weather field. The quake
        // preset owns that look; tsunami still flags ocean-risk framing downstream.
        const tsunami = Boolean(q.tsunami);
        // Hold scales with the headline: a Great quake dwells far longer than a
        // Light one — the operator tunes each magnitude class (quakeHoldSeconds).
        const seg = make("quake", q.quakeId, c.title, c.subtitle, [q.lng, q.lat], 5, quakeHoldMs(cfg, q.mag), cfg);
        seg.tsunami = tsunami;
        seg.quake = { mag: q.mag, depthKm: q.depthKm };
        seg.details = c.details;
        const breaking = q.time ? now - q.time.getTime() <= BREAKING_NEWS_WINDOW_MS : false;
        pool.push({ score: 40 + q.mag * 10, segment: seg, breaking });
      }
    } catch {
      /* no quakes cached yet — fillers carry the show */
    }
  }

  // --- Volcanoes: erupting/unrest only; dormant carries no headline. ---
  if (cfg.kinds.volcano) {
    try {
      const volcanoes = (await db.volcanoes.list()).filter((v) => v.status !== "dormant");
      for (const v of volcanoes) {
        const c = volcanoSegmentContent(v);
        const sev = volcanoStatusToSeverity(v.status);
        const seg = make("volcano", v.id, c.title, c.subtitle, [v.lng, v.lat], VOLCANO_ZOOM, volcanoHoldMs(cfg, v.status), cfg);
        seg.icon = c.icon;
        seg.details = c.details;
        // Same TrackInfo the manual click path builds — see segments.ts#volcanoTrackInfo.
        seg.trackInfo = volcanoTrackInfo(v);
        const breaking = v.status === "erupting" && now - v.statusChangedAt <= VOLCANO_BREAKING_WINDOW_MS;
        pool.push({ score: 50 + sev * 12, segment: seg, breaking });
      }
    } catch {
      /* no volcanoes cached yet — fillers carry the show */
    }
  }

  // --- Ocean monitoring points: DB-backed catalog (currents/features plus
  // real depth-monitoring regions — Niño boxes, Atlantic MDR, North Sea, Med,
  // Indian Ocean Dipole). Same "ocean" kind, fair-rotated alongside the global
  // spin filler above, but holding steady (autoSpin off, or a slow drift for
  // depth-cycle shots) so a real, specific location is on camera instead of
  // wherever the spin happened to drift to (the sea-temp-at-depth
  // profile/map need an actual ocean point). Managed at /admin/sea-points —
  // `enabled: false` points are simply skipped, no favourites list needed. ---
  if (cfg.kinds.ocean) {
    try {
      const seaPoints = (await db.seaPoints.list()).filter((p) => p.enabled);
      for (const p of seaPoints) {
        const patch = p.depthCycle
          ? { activeVariable: "sst", autoSpin: true, spinSpeed: 2.5 }
          : { activeVariable: "sst", autoSpin: false };
        const seg = make("ocean", p.pointId, p.name, `Ocean temperature · ${p.blurb}`, [p.lng, p.lat], p.zoom, kindHoldMs(cfg, "ocean"), cfg, patch);
        seg.depthCycle = p.depthCycle;
        pool.push({ score: 6, segment: seg });
      }
    } catch {
      /* no sea points seeded yet — fillers carry the show */
    }
  }

  // --- Severe weather: normalised severity ranks; centroid from the polygon.
  //     Scanned deep but capped per country (ALERT_COUNTRY_CAP) so the pool
  //     spans the world's active warnings, not one chatty source's. ---
  if (cfg.kinds.storm) {
    try {
      const alerts = await db.alerts.list({ activeOnly: true, severityMin: cfg.minAlertSeverity, limit: ALERT_SCAN_LIMIT });
      const perCountry = new Map<string, number>();
      let stormCount = 0;
      for (const a of alerts as any[]) {
        if (stormCount >= ALERT_POOL_CAP) break;
        const info = Array.isArray(a.info) ? a.info[0] : undefined;
        const area = info?.area?.[0];
        const center = alertRepPoint(area?.geometry);
        if (!center) continue; // geocode-only alert (no polygon) — can't frame it
        // Country is the editorial area for alert rotation AND the pool cap. A
        // numeric camera distance alone is too weak here: large countries
        // (notably Kazakhstan) can have alerts many degrees apart while still
        // looking like the same repeated destination on air. Alerts whose
        // source encodes no country bucket by the selector's own coarse cell so
        // an undecodable source can't flood the pool either.
        const countryCode = alertCountryCode(a);
        const capKey = countryCode ? `country:${countryCode}` : coarseGeoCell(center) ?? "cell:unknown";
        const used = perCountry.get(capKey) ?? 0;
        if (used >= ALERT_COUNTRY_CAP) continue;
        const sev = typeof a.maxSeverityRank === "number" ? a.maxSeverityRank : info?.severityRank ?? 0;
        const sinceIso = info?.onset ?? info?.effective ?? a.sent;
        const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
        // "Breaking" must be keyed off when WE first saw this (source, identifier)
        // pair (`created`, Mongoose-managed — untouched by the `$set` on every
        // re-upsert), NOT the CAP onset/effective/sent above: national met
        // services routinely re-stamp those on every refresh of an ONGOING
        // warning, so deriving freshness from them made a days-old Extreme
        // alert look permanently brand-new and camp the priority tier forever
        // (it kept winning selectPriority's "highest-scored breaking" pick).
        const firstSeenMs = a.created ? new Date(a.created).getTime() : NaN;
        const hazard = classifyHazard({ event: info?.event, translatedEvent: info?.translatedHeadline, parameters: info?.parameters });
        // The hazard drives which maps the shot cycles — open on the plan's
        // first field. How LONG it holds is the severity's call: the operator
        // tunes each level (stormHoldSeconds), Extreme lingering the longest.
        const plan = hazardMapPlan(hazard);
        // Same classification/labels the map badge/legend + click-to-select card
        // use — subtitle leads with place then country ("Brest Region · 🇧🇾 Belarus").
        const c = alertSegmentContent({
          source: String(a.source),
          identifier: String(a.identifier),
          event: info?.event,
          translatedEvent: info?.translatedHeadline,
          severityRank: sev,
          level: info?.sourceSeverity,
          areaDesc: area?.areaDesc,
          hazard,
          center,
          sinceMs: Number.isNaN(sinceMs) ? undefined : sinceMs,
        });
        const seg = make("storm", `${a.source}:${a.identifier}`, c.title, c.subtitle, center, 4.5, stormHoldMs(cfg, sev), cfg, {
          activeVariable: plan.cycle[0],
        });
        seg.hazard = hazard;
        seg.icon = c.icon;
        seg.details = c.details;
        const breaking = !Number.isNaN(firstSeenMs) && now - firstSeenMs <= BREAKING_NEWS_WINDOW_MS;
        perCountry.set(capKey, used + 1);
        stormCount += 1;
        pool.push({
          score: 50 + sev * 12,
          segment: seg,
          breaking,
          areaKey: countryCode ? `country:${countryCode}` : undefined,
        });
      }
    } catch {
      /* alerts not ingested — skip */
    }
  }

  // --- Notable aircraft: ONLY craft matching the enriched catalog (any altitude —
  //     a VIP on approach still counts). Every flight segment therefore carries a
  //     Track Info card; plain unenriched blips never make the pool. ---
  if (cfg.kinds.flight) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "aircraft" });
      const chosen = rows.filter((r) => notableByKey.has(vehicleId("aircraft", r.externalId)));
      // Join the cached hexdb metadata (registration/type/operator) by ICAO24 —
      // same lookup the public aircraft route uses, keyed by lowercase hex.
      const icaos = [...new Set(chosen.map((r) => r.externalId.toLowerCase()))];
      const metaRes = icaos.length
        ? await db.aircraftMeta.getAll({ id: { $in: icaos } }, { limit: icaos.length, sort: null })
        : { data: [] };
      const metaById = new Map((metaRes.data ?? []).map((m) => [m.id, m]));
      for (const r of chosen) {
        const notable = notableByKey.get(vehicleId("aircraft", r.externalId))!;
        const name = vehicleLabel(notable);
        const hasAlt = typeof r.altM === "number";
        const altKft = hasAlt ? Math.round(((r.altM as number) * 3.281) / 100) / 10 : 0;
        const m = metaById.get(r.externalId.toLowerCase());
        // Flag from OpenSky origin_country; lead the subtitle with it when known.
        const flag = countryNameFlag(r.country);
        const subtitle = `${flag ? `${flag} ` : ""}Aircraft${hasAlt ? ` · FL${Math.round(altKft * 10)}` : ""}`;
        const seg = make("flight", r.externalId, name, subtitle, [r.lng, r.lat], 6, kindHoldMs(cfg, "flight"), cfg);
        const details: Detail[] = [];
        if (m?.type) details.push({ label: "Type", value: m.type });
        if (m?.operator) details.push({ label: "Operator", value: m.operator });
        if (m?.registration) details.push({ label: "Registration", value: m.registration });
        if (r.country) details.push({ label: "Origin", value: `${flag ? `${flag} ` : ""}${r.country}` });
        if (hasAlt) details.push({ label: "Altitude", value: `FL${Math.round(altKft * 10)} · ${Math.round(r.altM as number).toLocaleString()} m` });
        if (typeof r.speed === "number") {
          const kt = Math.round((r.speed as number) * 1.94384);
          details.push({ label: "Speed", value: `${kt} kn · ${Math.round(kt * 1.852)} km/h` });
        }
        if (typeof r.headingDeg === "number") details.push({ label: "Heading", value: `${Math.round(r.headingDeg)}°` });
        // Climb/descent — only when it's meaningfully off level (~100 fpm), rounded
        // to the nearest 50 fpm so a live jitter doesn't read as spurious precision.
        if (typeof r.verticalRateMS === "number" && Math.abs(r.verticalRateMS) >= 0.5) {
          const fpm = Math.round((Math.abs(r.verticalRateMS as number) * 196.85) / 50) * 50;
          const climbing = (r.verticalRateMS as number) > 0;
          details.push({ label: "Vert. rate", value: `${climbing ? "▲" : "▼"} ${fpm.toLocaleString()} fpm` });
        }
        // Live ADS-B callsign (e.g. flight number) — distinct from the catalog name.
        const call = r.name?.trim();
        if (call && call.toUpperCase() !== name.toUpperCase()) details.push({ label: "Callsign", value: call });
        seg.details = details;
        seg.trackInfo = notableTrackInfo(notable, { type: m?.type, operator: m?.operator, registration: m?.registration, flag, country: r.country });
        pool.push({ score: notable.vip ? VIP_SCORE : NOTABLE_SCORE, segment: seg });
      }
    } catch {
      /* no aircraft frame — skip */
    }
  }

  // --- Notable ships: ONLY vessels matching the enriched catalog (any speed).
  //     Every ship segment therefore carries a Track Info card; plain unenriched
  //     AIS blips never make the pool. ---
  if (cfg.kinds.ship) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "ship" });
      const chosen = rows.filter((r) => notableByKey.has(vehicleId("ship", r.externalId)));
      for (const r of chosen) {
        const notable = notableByKey.get(vehicleId("ship", r.externalId))!;
        // Flag country from the MMSI MID (first 3 digits) — no feed call needed.
        const country = mmsiCountry(r.externalId);
        const name = vehicleLabel(notable);
        const spd = typeof r.speed === "number" ? Math.round(r.speed) : undefined;
        const subtitle = `${country?.flag ? `${country.flag} ` : ""}Vessel${spd != null ? ` · ${spd} kn` : ""}`;
        const seg = make("ship", r.externalId, name, subtitle, [r.lng, r.lat], 6.5, kindHoldMs(cfg, "ship"), cfg);
        const details: Detail[] = [];
        if (spd != null) details.push({ label: "Speed", value: `${spd} kn` });
        if (typeof r.headingDeg === "number") details.push({ label: "Course", value: `${Math.round(r.headingDeg)}°` });
        if (country) details.push({ label: "Flag", value: `${country.flag ? `${country.flag} ` : ""}${country.name}` });
        details.push({ label: "MMSI", value: r.externalId });
        seg.details = details;
        seg.trackInfo = notableTrackInfo(notable, { flag: country?.flag, country: country?.name });
        pool.push({ score: notable.vip ? VIP_SCORE : NOTABLE_SCORE, segment: seg });
      }
    } catch {
      /* no ship frame — skip */
    }
  }

  return pool;
}
