/**
 * Build the scored candidate pool the director picks from each cut. Live events
 * (earthquakes, severe-weather alerts, notable flights/ships) come from the same
 * Mongo caches the public overlays read; curated regions (ROIs + a global intro)
 * are always added as filler so the channel never runs out of somewhere to look.
 *
 * Pure-ish: takes a DB facade + config, returns Candidates. Scoring lives here
 * so "what's newsworthy" is one readable place to tune.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  kindHoldMs,
  quakeHoldMs,
  stormHoldMs,
  type DirectorConfig,
  type Segment,
  type SegmentKind,
  type SegmentSummaryStop,
  type TrackInfo,
} from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import { DEFAULT_WIND_SETTINGS } from "@photonsurge/shared/control";
import { vehicleId, vehicleLabel, type iVehicle } from "@photonsurge/shared/db/vehicle-model";
import {
  PRESETS,
  REGIONS_OF_INTEREST,
  GLOBAL_VIEW,
  OCEAN_VIEW_ZOOM,
  globalMapTour,
  ORBITAL_VIEW_ZOOM,
  ORBITAL_VIEWS,
} from "@photonsurge/shared/director-rois";
import { countryShot } from "@photonsurge/shared/director-countries";
import { SEA_POINTS } from "@photonsurge/shared/director-sea-points";
import { adMediaPath } from "@photonsurge/shared/ads/types";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { hazardMapPlan } from "@photonsurge/shared/alerts/hazard-director";
import { quakeSegmentContent, alertSegmentContent, volcanoSegmentContent } from "@photonsurge/shared/segments";
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
const VOLCANO_ZOOM = 6;

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

/** Curated filler: one global intro spin + a rotation of regions of interest. */
function fillerCandidates(cfg: DirectorConfig): Candidate[] {
  const out: Candidate[] = [];
  if (cfg.kinds.intro) {
    out.push({
      score: 6,
      segment: make("intro", "global", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, kindHoldMs(cfg, "intro"), cfg),
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

    // Notable named sea points — same "ocean" kind, fair-rotated alongside the
    // spin above, but holding steady (autoSpin off) so a real, specific
    // location is on camera instead of wherever the spin happened to drift
    // to (the sea-temp-at-depth profile/map need an actual ocean point).
    for (const p of SEA_POINTS) {
      out.push({
        score: 6,
        segment: make(
          "ocean",
          p.id,
          p.name,
          `Ocean temperature · ${p.blurb}`,
          p.center,
          p.zoom,
          kindHoldMs(cfg, "ocean"),
          cfg,
          { activeVariable: "sst", autoSpin: false },
        ),
      });
    }
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
  if (cfg.kinds.tour) {
    for (const roi of REGIONS_OF_INTEREST) {
      out.push({
        score: 5,
        segment: make("tour", roi.id, roi.name, "Regional weather · Pressure & radar", roi.center, roi.zoom, kindHoldMs(cfg, "tour"), cfg),
      });
    }
  }
  if (cfg.kinds.country) {
    // The operator's favourite countries (DirectorConfig.countries) — one
    // spotlight candidate each; unknown ids (stale config) are just skipped.
    for (const id of cfg.countries) {
      const c = countryShot(id);
      if (!c) continue;
      const seg = make("country", c.id, c.name, "Country spotlight · National weather", c.center, c.zoom, kindHoldMs(cfg, "country"), cfg);
      seg.icon = c.flag;
      out.push({ score: 6, segment: seg });
    }
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
const SUMMARY_MAX_HOLD_MS = 60_000;

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
 * One candidate per period whose latest round-up has a real narrative, hasn't
 * already aired this session (`seenCounts`), and isn't stale (the director was
 * off for a while and the round-up is no longer "current"). Unlike ads this is
 * a normal scored candidate — it competes in the pool like any other filler,
 * it's just guaranteed to disappear once shown instead of repeating.
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
    const id = `summary:${doc.id}`;
    if (seenCounts?.get(id)) continue; // already aired this session
    if (now - new Date(doc.generatedAt).getTime() > staleAfterMs) continue;

    const words = doc.narrative.trim().split(/\s+/).length;
    const holdMs = Math.min(
      SUMMARY_MAX_HOLD_MS,
      Math.max(kindHoldMs(cfg, "summary"), Math.round((words / SUMMARY_WORDS_PER_MIN) * 60_000)),
    );
    const seg = make("summary", doc.id, "Global Round-Up", label, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, holdMs, cfg);
    seg.summary = {
      id: doc.id,
      period,
      narrative: doc.narrative,
      generatedAt: doc.generatedAt instanceof Date ? doc.generatedAt.toISOString() : String(doc.generatedAt),
      stops: summaryStops(doc),
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
  if (cfg.kinds.summary) pool.push(...(await summaryCandidates(db, cfg, seenCounts)));

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

  // --- Volcanoes: reuses the "storm" kind/toggle (see select-segment.ts's
  //     volcanoToSegment — a volcano's status IS a hazard classification, not a
  //     dedicated SegmentKind). Erupting/unrest only; dormant carries no headline. ---
  if (cfg.kinds.storm) {
    try {
      const volcanoes = (await db.volcanoes.list()).filter((v) => v.status !== "dormant");
      for (const v of volcanoes) {
        const c = volcanoSegmentContent(v);
        const sev = volcanoStatusToSeverity(v.status);
        const seg = make("storm", `volcano:${v.id}`, c.title, c.subtitle, [v.lng, v.lat], VOLCANO_ZOOM, stormHoldMs(cfg, sev), cfg);
        seg.hazard = "volcano";
        seg.icon = c.icon;
        seg.details = c.details;
        // Same TrackInfo shape (photo/blurb) the manual click path builds — see
        // select-segment.ts's volcanoToSegment for why the bulletin text wins
        // over the evergreen Wikipedia extract when both are present.
        seg.trackInfo = v.wikiThumb || v.wikiExtract || v.latestReport
          ? { label: v.name, category: "Volcano", photoUrl: v.wikiThumb, extract: v.latestReport || v.wikiExtract }
          : undefined;
        const breaking = v.status === "erupting" && now - v.statusChangedAt <= VOLCANO_BREAKING_WINDOW_MS;
        pool.push({ score: 50 + sev * 12, segment: seg, breaking });
      }
    } catch {
      /* no volcanoes cached yet — fillers carry the show */
    }
  }

  // --- Severe weather: normalised severity ranks; centroid from the polygon. ---
  if (cfg.kinds.storm) {
    try {
      const alerts = await db.alerts.list({ activeOnly: true, severityMin: cfg.minAlertSeverity, limit: 40 });
      for (const a of alerts as any[]) {
        const info = Array.isArray(a.info) ? a.info[0] : undefined;
        const area = info?.area?.[0];
        const center = alertRepPoint(area?.geometry);
        if (!center) continue; // geocode-only alert (no polygon) — can't frame it
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
        const hazard = classifyHazard({ event: info?.event, parameters: info?.parameters });
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
        pool.push({ score: 50 + sev * 12, segment: seg, breaking });
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
        ? await db.aircraftMeta.getAll({ id: { $in: icaos } }, { limit: icaos.length })
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
        if (typeof r.headingDeg === "number") details.push({ label: "Heading", value: `${Math.round(r.headingDeg)}°` });
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
