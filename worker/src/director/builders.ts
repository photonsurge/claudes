/**
 * Single-item segment builders: each turns ONE subject (a quake doc, an alert
 * doc, a volcano doc, a curated country/region shot, an EventSummary doc) into
 * ONE scored Candidate. The pool loops in candidates.ts call these for every
 * item they list; anything that's a property of the POOL rather than the item
 * (list queries + limits, per-country caps, the pool cap, already-aired skips)
 * stays in those loops. Shared so a shot built from one known subject (a
 * scripted clip, a break-in, an operator command) is identical to the same
 * subject airing through rotation.
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
} from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import { DEFAULT_WIND_SETTINGS } from "@photonsurge/shared/control";
import type { iRegionCity } from "@photonsurge/shared/db/region-model";
import { PRESETS, ROUNDUP_MARKERS, GLOBAL_VIEW } from "@photonsurge/shared/director-rois";
import type { CountryShot } from "@photonsurge/shared/director-countries";
import type { RegionShot } from "@photonsurge/shared/director-regions";
import type { iCountryModel } from "@photonsurge/shared/db/country-model";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { quakeSegmentContent, alertSegmentContent, volcanoSegmentContent, volcanoTrackInfo } from "@photonsurge/shared/segments";
import { discLookFeeds, type SatImgFeedState } from "@photonsurge/shared/satimg/types";
import type { SummaryPeriod, iEventSummaryModel } from "@photonsurge/shared/db/event-summary-model";
import type { iQuakeModel } from "@photonsurge/shared/db/quake-model";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { volcanoStatusToSeverity } from "../summaries/aggregate";

export const make = (
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

/** A country shot's subtitle: a tour of the nation, or one framed spotlight.
 *  Exposed so a scripted clip that strips the tour can say what really airs. */
export const countrySubtitle = (toured: boolean): string =>
  toured ? "Country tour · National weather" : "Country spotlight · National weather";

/** An area shot's subtitle: a tour of its countries, or one framed spotlight. */
export const regionSubtitle = (toured: boolean): string =>
  toured ? "Area tour · Regional weather" : "Region spotlight · Regional weather";

/**
 * One country spotlight. Airs as a "go round the nation" tour when its
 * precomputed `tourCities` dossier exists (the client flies the camera to each
 * city, showing its weather), else falls back to the curated single framed shot
 * — so a country the tour job hasn't reached yet still airs, exactly as before.
 * Operator favourites (`cfg.countries`) get the heavier rotation weight. Mirrors
 * regionCandidate.
 */
export async function countryCandidate(db: AppDb, shot: CountryShot, cfg: DirectorConfig): Promise<Candidate> {
  const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
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
  const seg = make("country", shot.id, shot.name, countrySubtitle(stops.length > 0), center, zoom, holdMs, cfg);
  seg.icon = shot.flag;
  if (stops.length) seg.tourStops = stops;
  return { score: 6, segment: seg, weight: cfg.countries.includes(shot.id) ? 5 : 1 };
}

/**
 * The recurring world spin — identical look to the intro opener (it tours the
 * same INTRO_MAP_TYPES client-side), aired as ordinary global filler and as a
 * scripted short's plain world shot.
 */
export function worldSpinCandidate(cfg: DirectorConfig): Candidate {
  return {
    score: 6,
    segment: make("global", "world", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, kindHoldMs(cfg, "global"), cfg),
  };
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
 * One Area. Airs as the "go round a place" tour when its bbox has cached cities
 * (the client flies the camera to each, showing its weather), else falls back to
 * a single framed spotlight. Camera framing is derived from the region bbox (see
 * director-regions). Operator favourites (`cfg.regions`) weigh heavier.
 */
export async function regionCandidate(db: AppDb, shot: RegionShot, cfg: DirectorConfig): Promise<Candidate> {
  const transitionMs = Math.round((cfg.transitionSeconds ?? 4) * 1000);
  const stops = await regionTourStops(db, shot.id);
  // Size the hold to fly EVERY city (flight + dwell each), floored by the
  // operator's per-kind minimum — no SUMMARY_MAX_TOUR_STOPS cap here, or the
  // tour would cut away mid-way through the later cities.
  const holdMs = stops.length
    ? Math.max(kindHoldMs(cfg, "region"), stops.length * (transitionMs + SUMMARY_STOP_DWELL_MS))
    : kindHoldMs(cfg, "region");
  const seg = make("region", shot.id, shot.name, regionSubtitle(stops.length > 0), shot.center, shot.zoom, holdMs, cfg);
  if (stops.length) seg.tourStops = stops;
  return { score: 6, segment: seg, weight: cfg.regions.includes(shot.id) ? 5 : 1 };
}

export const SUMMARY_PERIODS: { period: SummaryPeriod; label: string; staleAfterMs: number }[] = [
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
export const SUMMARY_STOP_DWELL_MS = 40_000;
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
 * One world round-up from one EventSummary doc, or null when the doc has no
 * real narrative to read.
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
export function summaryCandidate(doc: iEventSummaryModel, period: SummaryPeriod, cfg: DirectorConfig): Candidate | null {
  if (doc.narrativeStatus !== "ok" || !doc.narrative.trim()) return null;
  const label = SUMMARY_PERIODS.find((p) => p.period === period)?.label ?? "";
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
  return { score: 8, segment: seg };
}

/** One earthquake: magnitude is the headline; recent + big ranks highest. */
export function quakeCandidate(q: iQuakeModel, cfg: DirectorConfig, now: number): Candidate {
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
  return { score: 40 + q.mag * 10, segment: seg, breaking };
}

/** One volcano, or null when it's dormant — dormant carries no headline. */
export function volcanoCandidate(v: Volcano, cfg: DirectorConfig, now: number): Candidate | null {
  if (v.status === "dormant") return null;
  const c = volcanoSegmentContent(v);
  const sev = volcanoStatusToSeverity(v.status);
  const seg = make("volcano", v.id, c.title, c.subtitle, [v.lng, v.lat], VOLCANO_ZOOM, volcanoHoldMs(cfg, v.status), cfg);
  seg.icon = c.icon;
  seg.details = c.details;
  // Same TrackInfo the manual click path builds — see segments.ts#volcanoTrackInfo.
  seg.trackInfo = volcanoTrackInfo(v);
  const breaking = v.status === "erupting" && now - v.statusChangedAt <= VOLCANO_BREAKING_WINDOW_MS;
  return { score: 50 + sev * 12, segment: seg, breaking };
}

/**
 * One severe-weather alert: normalised severity ranks; centroid from the
 * polygon. `info`/`area` are the alert's first info block and its first area
 * (what the pool loop already pulled out). Null for a geocode-only alert (no
 * polygon) — there's nothing to frame.
 */
export function stormCandidate(a: any, info: any, area: any, cfg: DirectorConfig, now: number): Candidate | null {
  const center = alertRepPoint(area?.geometry);
  if (!center) return null;
  // Country is the editorial area for alert rotation (see the pool loop's
  // per-country cap); alerts whose source encodes no country carry no areaKey.
  const countryCode = alertCountryCode(a);
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
  return {
    score: 50 + sev * 12,
    segment: seg,
    breaking,
    areaKey: countryCode ? `country:${countryCode}` : undefined,
  };
}
