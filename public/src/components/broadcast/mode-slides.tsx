"use client";

/**
 * The ordered LEFT-COLUMN slide deck for the on-air segment — one readable list
 * per director "mode", each slide guarded by whether it actually has content
 * (dynamic: e.g. the "cities near" enrichment only appears when there are
 * nearby cities; a volcano's facts/nearby pages only when they carry data).
 *
 * This replaces BroadcastFrame's old nested-ternary `leftBottomPanel` plus the
 * hand-wired `usePagedSlides` page bookkeeping (quakeSlide / wideCitiesSlide /
 * volcanoSlide + display:block/none toggles). <SlideDeck> rotates through
 * whatever this returns and keeps every slide mounted, so each panel's own
 * featured-city cycle / fetched data survives a rotation.
 *
 * NB: unrelated to `DirectorConfig.kindSlides` / director-slides.ts — those are
 * saved MAP-LOOK snapshots (basemap/wind/overlays), not left-column cards.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { iSummaryStats } from "@photonsurge/shared/db/event-summary-model";
import type { AlertFeature, AlertTimelineBeat, iAlertSeries, iAlertResource, AlertSnapshotMeta } from "../../lib/alerts";
import type { HazardType } from "../../lib/hazard";
import type { Quake } from "../../lib/tracks/types";
import type { WorldSummary } from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import type { CountryAt } from "../../lib/countries";
import type { Cam } from "../../lib/cams/types";
import type { BroadcastTheme } from "./config";
import { applySlidePrefs, type SlideId } from "@photonsurge/shared/broadcast-slides";
import type { DeckSlide } from "./SlideDeck";
import { KIND_COLOR, isTargetedEvent } from "./kinds";
import OnAirCard from "./OnAirCard";
import CountryPanel from "./CountryPanel";
import AreaAlertsPanel from "./AreaAlertsPanel";
import TopCitiesPanel from "./TopCitiesPanel";
import CityConditionsPanel from "./CityConditionsPanel";
import CityForecastPanel from "./CityForecastPanel";
import ForecastPanel from "./ForecastPanel";
import PointHistoryPanel from "./PointHistoryPanel";
import DepthProfilePanel from "./DepthProfilePanel";
import RoundupStatsPanel from "./RoundupStatsPanel";
import PlaceRoundupPanel, {
  placeRoundupSlideHasContent,
  placeRoundupMainHasContent,
  placeRoundupNext24HasContent,
} from "./PlaceRoundupPanel";
import type { PlaceRoundup } from "../../lib/placeRoundups";
import QuakeReport from "./QuakeReport";
import AlertTimelinePanel, { alertTimelineSlideHasContent } from "./AlertTimelinePanel";
import AlertMediaPanel, { alertMediaSlideHasContent } from "./AlertMediaPanel";
import EventTimelinePanel, { eventTimelineSlideHasContent } from "./EventTimelinePanel";
import EventMediaPanel, { eventMediaSlideHasContent } from "./EventMediaPanel";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { iEventResource } from "@photonsurge/shared/db/event-resource-model";
import type { iEventSeries } from "@photonsurge/shared/db/event-series-model";
import EventNearbyPanel, { eventNearbySlideHasContent } from "./EventNearbyPanel";
import TrackInfoPanel from "./TrackInfoPanel";
import VolcanoFactsPanel, { volcanoFactsSlideHasContent } from "./VolcanoFactsPanel";
import VolcanoNearbyPanel, { volcanoNearbySlideHasContent } from "./VolcanoNearbyPanel";
import VolcanoCamerasPanel, { airableVolcanoCams } from "./VolcanoCamerasPanel";
import VolcanoCamGridPanel, { volcanoCamGridSlideHasContent } from "./VolcanoCamGridPanel";
import VolcanoGeologyPanel, { volcanoGeologySlideHasContent } from "./VolcanoGeologyPanel";
import VolcanoEruptionsPanel, { volcanoEruptionsSlideHasContent } from "./VolcanoEruptionsPanel";
import type { FocusVolcanoCam } from "../../lib/focus/types";
import type { VolcanoEruption } from "@photonsurge/shared/db/volcano-eruption-repo";
import VolcanoMediaPanel, { volcanoMediaSlideHasContent } from "./VolcanoMediaPanel";
import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import RegionNearTermPanel from "./RegionNearTermPanel";
import RegionCountryPanel from "./RegionCountryPanel";
import type { iRegionModel } from "@photonsurge/shared/db/region-model";
import type { FocusRegionCountry } from "../../lib/focus/types";
import type { ForecastStep } from "../../lib/weather-forecast";

const FALLBACK_ACCENT = "#38bdf8";

/**
 * The "area details" every mode's uniform first slide (OnAirCard) carries — a
 * photo + short blurb for the place currently on air, resolved from the enriched
 * Country catalog (worker/src/jobs/countries.ts) via /api/countries/at. Null over
 * ocean / outside every country, or before the area has been enriched.
 */
export interface AreaInfo {
  name: string;
  photo: string | null;
  blurb: string | null;
  iso2?: string;
}

export interface ModeSlideContext {
  /** Curated cities — for the quake/event "cities near" + volcano nearby slides. */
  cities: City[];
  /** Worker-cached webcams — for the "near this event" slide. */
  cams: Cam[];
  /** Full global feeds — for the volcano "what else is nearby" content guard. */
  quakes: Quake[];
  alerts: AlertFeature[];
  /** The hazard type the globe is currently lighting (lib/alert-cycle), or null
   *  when the cycle is off/inert — marks the matching row of the IN VIEW rollup. */
  activeHazard?: HazardType | null;
  /** The on-air volcano's official monitoring cameras — from the focus call. */
  /** ACTIVE cameras for the on-air volcano, already joined to our locally-stored
   *  latest frame — composed on the focus call, never fetched per cut. */
  volcanoCams: FocusVolcanoCam[];
  /** The on-air volcano's GVP eruption history (a catalog fact — no event needed). */
  volcanoEruptions: VolcanoEruption[];
  /** The on-air volcano itself, for its GVP catalog/geology facts. */
  volcano?: Volcano;
  /** Latest stored camera/satellite/official imagery from the focus bundle. */
  volcanoMedia: VolcanoMedia[];
  /** The on-air storm's derived change timeline (ISSUED → changes → ENDED) — the
   *  alert-timeline slide's data, delivered on the focus bundle. Empty off a storm. */
  alertTimeline: AlertTimelineBeat[];
  /** The on-air storm's captured snapshots / harvested resources / metric series
   *  (focus bundle) — the alert-media slide. Empty off a storm. */
  alertSnapshots: AlertSnapshotMeta[];
  alertResources: iAlertResource[];
  alertSeries: iAlertSeries[];
  /** The unified cross-source event timeline/media (focus bundle) — the storm deck
   *  prefers these over the alert equivalents once the storm was promoted to a
   *  WatchedEvent (they're the superset); empty otherwise. */
  eventTimeline: EventTimelineBeat[];
  eventSnapshots: EventSnapshotMeta[];
  eventResources: iEventResource[];
  eventSeries: iEventSeries[];
  /** Feeds already scoped to the on-air area — for the OnAirCard rollup. */
  areaAlerts: AlertFeature[];
  areaQuakes: Quake[];
  areaVolcanoes: Volcano[];
  /** Set ONLY on a whole-globe spin (no framed area): the authoritative world
   *  alert tally, so the OnAirCard lede reads "WORLDWIDE" with a per-continent
   *  breakdown instead of a meaningless whole-planet "IN VIEW" count. Null on any
   *  framed shot (country/region/event/summary), where the scoped rollup stands. */
  world?: WorldSummary | null;
  /** Set for a country spotlight (or other wide framed shot) — enables the TOP
   *  CITIES + top-5 city-forecast slides (bbox the framed area was scoped to). */
  wideCitiesBbox?: [number, number, number, number];
  /** A country spotlight's ISO code — scopes the CITIES / FORECAST slides to the
   *  nation's own cities (by `cc`), not whatever fell inside `wideCitiesBbox`.
   *  Absent on region / round-up shots, which span countries and keep the bbox. */
  wideCitiesCc?: string;
  /** Focus point / framed bbox for the WEATHER (forecast) + CURRENT & RECENT
   *  (AREA HISTORY) + ocean-depth slides. Folded into the deck so the left
   *  column is ONE rotating card per mode instead of a tall stack. */
  histCenter: [number, number] | null;
  histBbox: [number, number, number, number] | null;
  /** Whether the on-air kind sits on a real ground location — gates the AREA
   *  HISTORY slide (global/orbital/intro shots have nothing to sample). */
  segmentHasLocation: boolean;
  /** A plain (non-region) wide shot's framed-area forecast has data — gates its
   *  weather slide (country/region/summary use the per-city forecast slide). */
  hasFramedForecast: boolean;
  /** Ocean scene — offers the sea-temp-by-depth slide. */
  showDepth: boolean;
  depthCenter: [number, number] | null;
  manifest: WeatherManifest | null;
  activeVariable: string | null;
  /** Round-up narrative + stats — folds the round-up's on-air card (narrative
   *  text and headline numbers) into the deck rather than the bottom ticker. */
  roundup?: { narrative?: string; stats?: iSummaryStats; sources?: string[] };
  /** The current global round-up (latest hourly), fetched independently of the
   *  segment — surfaces the round-up narrative + headline numbers on the plain
   *  world spins (intro/global/ocean/orbital) that carry no `segment.summary`
   *  tour of their own. */
  worldRoundup?: { narrative?: string; stats?: iSummaryStats; sources?: string[] };
  /** The framed place's latest per-place round-up (CountryRoundup for a country
   *  spotlight, RegionRoundup for a region/area spotlight — both from the
   *  place-roundups feature) — folded in as the spotlight's SECOND slide, the
   *  "state of the place" AI narrative + place-scoped tally, right after the
   *  on-air lede. Null off a spotlight or before the place has a round-up. */
  placeRoundup?: PlaceRoundup | null;
  /** The enriched country the round-up tour is currently parked on (resolved
   *  per stop via /api/countries/at) — drives the summary deck's "the nation"
   *  card. Null when the stop is over ocean / outside every country. */
  summaryCountry?: CountryAt | null;
  /** Enriched "where we are" — the DB country (photo + blurb) under the on-air
   *  point, resolved in BroadcastFrame via /api/countries/at. Rendered as the
   *  uniform lede's area block on EVERY mode's first slide. */
  areaInfo?: AreaInfo | null;
  /** The enriched Region doc under a region ("area") spotlight — used for the
   *  NEXT 24H card's sample-city label. Null off a region shot. */
  region?: iRegionModel | null;
  /** Region spotlight per-country forecasts (from the focus bundle — one worker
   *  sample per top member country at its biggest in-region city). One deck slide
   *  each. Empty off a region shot. */
  regionCountries?: FocusRegionCountry[];
  /** Region spotlight NEXT 24H near-term forecast steps (from the focus bundle —
   *  the 72h track at the region's biggest city). Empty off a region shot. */
  regionNearTerm?: ForecastStep[];
  theme: BroadcastTheme;
  /** Per-channel deck slide off-list (ControlState.slidesOff) — hidden ids. */
  slidesOff?: SlideId[];
  /** Per-channel deck slide ranking (ControlState.slideOrder). */
  slideOrder?: SlideId[];
  /** Per-channel hidden POINT/AREA HISTORY variables (ControlState.pointVarsOff). */
  pointVarsOff?: string[];
}

/**
 * The shared "context" slides every located wide shot carries after its own
 * mode cards: WEATHER (framed-area forecast) is pushed by the caller (its data
 * guard differs region vs. plain), then CURRENT & RECENT (AREA HISTORY trend
 * charts) and, on ocean scenes, the sea-temp-by-depth profile. Folded in here
 * so they rotate as slides instead of stacking below the deck.
 */
function contextSlides(ctx: ModeSlideContext): DeckSlide[] {
  const out: DeckSlide[] = [];
  if (ctx.segmentHasLocation && (ctx.histCenter || ctx.histBbox)) {
    out.push({ id: "history", node: <PointHistoryPanel center={ctx.histCenter} bbox={ctx.histBbox} theme={ctx.theme} varsOff={ctx.pointVarsOff} /> });
  }
  if (ctx.showDepth && ctx.depthCenter) {
    out.push({
      id: "depth",
      node: (
        <DepthProfilePanel
          center={ctx.depthCenter}
          manifest={ctx.manifest}
          activeVariable={ctx.activeVariable}
          theme={ctx.theme}
        />
      ),
    });
  }
  return out;
}

/**
 * The mode's ordered, content-filtered deck, with the channel's per-slide
 * preferences applied on top: hidden ids dropped (never the pinned `onair`
 * lede) and the remainder stable-sorted by `slideOrder`. Caller guards
 * `segment` non-null.
 */
export function modeSlides(segment: Segment, ctx: ModeSlideContext): DeckSlide[] {
  return applySlidePrefs(composeModeSlides(segment, ctx), ctx.slidesOff ?? [], ctx.slideOrder ?? []);
}

/** Builds the mode's natural, content-filtered deck (before channel prefs). */
function composeModeSlides(segment: Segment, ctx: ModeSlideContext): DeckSlide[] {
  const color = KIND_COLOR[segment.kind] ?? FALLBACK_ACCENT;
  const slides: DeckSlide[] = [];

  // Uniform lede — EVERY director mode opens with the same on-air card: kind
  // badge, event title and the pulsing ON AIR flag, plus the "where we are"
  // area photo/blurb (ctx.areaInfo) and the local alerts/quakes/volcanoes
  // rollup. The mode's own detail cards (seismic report, track info, cities,
  // forecast…) follow as the remaining slides, so every mode reads the same on
  // its first page.
  slides.push({
    id: "onair",
    node: (
      <OnAirCard
        segment={segment}
        alerts={ctx.areaAlerts}
        activeHazard={ctx.activeHazard ?? null}
        quakes={ctx.areaQuakes}
        volcanoes={ctx.areaVolcanoes}
        areaInfo={ctx.areaInfo}
        world={ctx.world}
        theme={ctx.theme}
      />
    ),
  });

  // Notable aircraft / ship / volcano — the rich Track Info card after the lede,
  // plus the two extra volcano pages whenever they carry content.
  if (segment.trackInfo != null) {
    slides.push({ id: "track", node: <TrackInfoPanel segment={segment} color={color} /> });
    if (segment.kind === "volcano") {
      if (volcanoFactsSlideHasContent(segment.trackInfo)) {
        slides.push({ id: "volcano-facts", node: <VolcanoFactsPanel info={segment.trackInfo} color={color} /> });
      }
      // GVP catalog geology — type, tectonic setting, rock, and the Smithsonian's
      // own write-up. A catalog fact, so it's there for a dormant volcano too;
      // self-hides until the catalog seed has run.
      if (volcanoGeologySlideHasContent(ctx.volcano)) {
        slides.push({ id: "volcano-geology", node: <VolcanoGeologyPanel volcano={ctx.volcano} color={color} /> });
      }
      // Eruption history (Band 2 of the per-volcano timeline) — centuries, kept on
      // its own card rather than sharing an axis with the days-long observation
      // record. Self-hides until `seedEruptions` has run.
      if (volcanoEruptionsSlideHasContent(ctx.volcanoEruptions)) {
        slides.push({
          id: "volcano-eruptions",
          node: <VolcanoEruptionsPanel eruptions={ctx.volcanoEruptions} color={color} />,
        });
      }
      // Official status timeline (level/aviation/VEI/plume changes) — reuses the
      // unified event timeline panel; self-hides until the volcano was promoted
      // and has stored beats (EVENTS_UNIFIED_ENABLED).
      if (eventTimelineSlideHasContent(ctx.eventTimeline)) {
        slides.push({
          id: "volcano-timeline",
          node: <EventTimelinePanel beats={ctx.eventTimeline} color={color} theme={ctx.theme} />,
        });
      }
      // Official monitoring cameras, HYBRID: a 2×2 overview establishes the volcano
      // from every angle at once, then EACH camera gets its own full-size page so
      // no angle is stuck off-air (Etna alone has ~8). Fed from the focus call,
      // already ACTIVE-only and ours-first; no cap — the deck rotates them all.
      // Both self-hide: the grid needs 2+ cameras, the pages need 1+.
      if (volcanoCamGridSlideHasContent(ctx.volcanoCams)) {
        slides.push({ id: "volcano-cams", node: <VolcanoCamGridPanel cams={ctx.volcanoCams} color={color} /> });
      }
      for (const cam of airableVolcanoCams(ctx.volcanoCams)) {
        slides.push({
          id: `volcano-cam:${cam.camId}`,
          node: <VolcanoCamerasPanel cam={cam} color={color} />,
        });
      }
      if (volcanoMediaSlideHasContent(ctx.volcanoMedia)) {
        slides.push({ id: "volcano-satellite", node: <VolcanoMediaPanel media={ctx.volcanoMedia} color={color} /> });
      }
      // Captured camera history — the worker-archived "earlier today / this week"
      // frames + timelapse render (EventSnapshots on the focus call). Self-hides
      // until the capture job has stored something. Same panel the storm cut uses.
      if (eventMediaSlideHasContent(ctx.eventSnapshots, ctx.eventResources)) {
        slides.push({
          id: "volcano-media",
          node: <EventMediaPanel snapshots={ctx.eventSnapshots} resources={ctx.eventResources} color={color} />,
        });
      }
      if (volcanoNearbySlideHasContent(segment.camera.center, ctx.cities, ctx.quakes, ctx.alerts)) {
        slides.push({
          id: "volcano-nearby",
          node: (
            <VolcanoNearbyPanel
              center={segment.camera.center}
              cities={ctx.cities}
              quakes={ctx.quakes}
              alerts={ctx.alerts}
              color={color}
            />
          ),
        });
      }
    }
    return slides;
  }

  // Targeted point event (storm / quake / …) — reads LEDE → [seismic breakdown]
  // → CLOSE CITIES → WEATHER → near-event extras. The quake report leads (quakes
  // only), then the same bbox-scoped TOP CITIES + CITY CONDITIONS pages a country
  // spotlight carries (framed to the event's area), so the affected towns air as
  // real pages from the full city DB instead of the old single sparse
  // "near this event" card. The detailed forecast follows, and the near-event
  // page (webcams / distance-ranked cycle) rides last, only when it carries
  // content beyond a bare city name.
  if (isTargetedEvent(segment.kind)) {
    if (segment.kind === "quake" && segment.quake) {
      slides.push({
        id: "quake",
        node: (
          <QuakeReport
            mag={segment.quake.mag}
            depthKm={segment.quake.depthKm}
            center={segment.camera.center}
            cities={ctx.cities}
            color={color}
          />
        ),
      });
    }
    // The storm's live change timeline, right after the lede — reads the beats
    // from the focus bundle. PREFER the unified cross-source event timeline (the
    // superset: promoted alert changes + deep-GDACS/Copernicus/EONET beats) when
    // the storm was promoted; fall back to the alert-only timeline otherwise.
    if (segment.kind === "storm") {
      if (eventTimelineSlideHasContent(ctx.eventTimeline)) {
        slides.push({ id: "event-timeline", node: <EventTimelinePanel beats={ctx.eventTimeline} color={color} theme={ctx.theme} /> });
      } else if (alertTimelineSlideHasContent(ctx.alertTimeline)) {
        slides.push({ id: "alert-timeline", node: <AlertTimelinePanel beats={ctx.alertTimeline} color={color} theme={ctx.theme} /> });
      }
    }
    // The storm's media — cross-source products/maps + snapshot + score sparkline,
    // preferring the unified event media (resources alone earn the slide), else the
    // alert imagery slide.
    if (segment.kind === "storm") {
      if (eventMediaSlideHasContent(ctx.eventSnapshots, ctx.eventResources)) {
        slides.push({
          id: "event-media",
          node: (
            <EventMediaPanel
              snapshots={ctx.eventSnapshots}
              resources={ctx.eventResources}
              series={ctx.eventSeries}
              color={color}
              theme={ctx.theme}
            />
          ),
        });
      } else if (alertMediaSlideHasContent(ctx.alertSnapshots)) {
        slides.push({
          id: "alert-media",
          node: (
            <AlertMediaPanel
              snapshots={ctx.alertSnapshots}
              resources={ctx.alertResources}
              series={ctx.alertSeries}
              color={color}
              theme={ctx.theme}
            />
          ),
        });
      }
    }
    if (ctx.histBbox) {
      slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.histBbox} color={color} /> });
      slides.push({ id: "cityconditions", node: <CityConditionsPanel bbox={ctx.histBbox} color={color} /> });
    }
    if (ctx.hasFramedForecast) {
      slides.push({ id: "forecast", node: <ForecastPanel center={ctx.histCenter} bbox={ctx.histBbox} theme={ctx.theme} /> });
    }
    if (eventNearbySlideHasContent(segment.camera.center, ctx.cities, ctx.cams)) {
      slides.push({
        id: "nearby",
        node: <EventNearbyPanel center={segment.camera.center} cities={ctx.cities} cams={ctx.cams} color={color} />,
      });
    }
    return slides;
  }

  // Round-up (a world spin carrying `segment.summary`) — a per-country package
  // that plays while the tour dwells on each stop: the "now viewing" IN VIEW
  // rollup (alerts/quakes/volcanoes), then the nation itself (flag/photo/blurb),
  // its area forecast (country weather), its active-alerts drill-down, its
  // capital + top cities (each with climate charts), and the round-up's own
  // narrative + headline numbers. Every country-scoped slide guards on real
  // content so an ocean/uncurated stop degrades to just the rollup + narrative.
  // `wideCitiesBbox` is the enriched country's real bbox here (set for the
  // round-up in BroadcastFrame), so cities/forecast reuse the same plumbing the
  // country spotlight does.
  if (segment.summary) {
    if (ctx.summaryCountry) {
      slides.push({ id: "nation", node: <CountryPanel country={ctx.summaryCountry} color={color} theme={ctx.theme} /> });
    }
    if (ctx.areaAlerts.length) {
      slides.push({ id: "alerts", node: <AreaAlertsPanel alerts={ctx.areaAlerts} color={color} theme={ctx.theme} /> });
    }
    if (ctx.wideCitiesBbox) {
      slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
      // The area weather slide: the framed nation's top-5 cities, each with its
      // live NOW temp + 3-day strip (replaces the old single country-wide aggregate).
      slides.push({ id: "forecast", node: <CityForecastPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    }
    if (ctx.roundup) {
      slides.push({
        id: "roundup",
        node: (
          <RoundupStatsPanel
            narrative={ctx.roundup.narrative}
            stats={ctx.roundup.stats}
            sources={ctx.roundup.sources}
            theme={ctx.theme}
          />
        ),
      });
    }
    return slides;
  }

  // Region ("area") spotlight — a MULTI-COUNTRY area, so it gets its own deck
  // rather than the country one: the country deck (START → ROUND-UP → CITIES →
  // WEATHER → HISTORY) is kept, but with region-specific slides slotted into the
  // weather block — a NEXT 24H near-term card (split out of the 3-day area
  // forecast) and ONE SLIDE PER top member country, each with that country's own
  // weather + 72h graph. Both read forecasts composed onto the focus bundle
  // (ctx.regionNearTerm / ctx.regionCountries — one worker sample per country at
  // its biggest in-region city), so nothing fans out per country at cut time.
  if (segment.kind === "region" && ctx.wideCitiesBbox) {
    // The round-up is split in two: the "state of the region" text/tally, then a
    // separate slide for the per-city NEXT 24 HOURS outlook (the "24h events"), so
    // the narrative doesn't run off one overlong card.
    if (placeRoundupMainHasContent(ctx.placeRoundup)) {
      slides.push({
        id: "place-roundup",
        node: <PlaceRoundupPanel roundup={ctx.placeRoundup!} section="main" theme={ctx.theme} />,
      });
    }
    if (placeRoundupNext24HasContent(ctx.placeRoundup)) {
      slides.push({
        id: "place-roundup-24h",
        node: <PlaceRoundupPanel roundup={ctx.placeRoundup!} section="next24" theme={ctx.theme} />,
      });
    }
    if (ctx.regionNearTerm && ctx.regionNearTerm.length) {
      slides.push({
        id: "region-next24",
        node: (
          <RegionNearTermPanel
            steps={ctx.regionNearTerm}
            sampleName={ctx.region?.topCities?.[0]?.name}
            color={color}
            theme={ctx.theme}
          />
        ),
      });
    }
    const countries = ctx.regionCountries ?? [];
    countries.forEach((c, i) => {
      slides.push({
        id: `region-country-${c.cc}`,
        node: <RegionCountryPanel country={c} rank={i + 1} total={countries.length} color={color} theme={ctx.theme} />,
      });
    });
    slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    // City forecasts live in the top-right report.
    slides.push(...contextSlides(ctx));
    return slides;
  }

  // Country spotlight / wide framed shot — reads START → ROUND-UP → CITIES →
  // WEATHER → CURRENT & RECENT: the "now viewing" area rollup, the framed place's
  // own AI round-up (when it has one), the area's close cities, the area forecast
  // (when it has data), then the AREA HISTORY trend charts. The round-up rides
  // second so the "state of the place" narrative reads right after the lede,
  // before the drill-down cards. (A region spotlight also sets wideCitiesBbox but
  // is handled by its own multi-country branch above.)
  if (ctx.wideCitiesBbox) {
    if (placeRoundupSlideHasContent(ctx.placeRoundup)) {
      slides.push({ id: "place-roundup", node: <PlaceRoundupPanel roundup={ctx.placeRoundup!} theme={ctx.theme} /> });
    }
    slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    // City forecasts live in the top-right report.
    slides.push(...contextSlides(ctx));
    return slides;
  }

  // Any other wide shot (intro / global / ocean / orbital) — after the lede, the
  // current global round-up (narrative + headline numbers), then the same
  // WEATHER → CURRENT & RECENT context slides. The round-up rides here — not
  // just the dedicated `segment.summary` tour above — so every world spin
  // carries the live "state of the planet" card. Gated on !segmentHasLocation so
  // only the genuine whole-world modes get it (a located weather-check shot that
  // also falls through here does not).
  if (!ctx.segmentHasLocation && ctx.worldRoundup) {
    slides.push({
      id: "roundup",
      node: (
        <RoundupStatsPanel
          narrative={ctx.worldRoundup.narrative}
          stats={ctx.worldRoundup.stats}
          sources={ctx.worldRoundup.sources}
          theme={ctx.theme}
        />
      ),
    });
  }
  if (ctx.hasFramedForecast) {
    slides.push({ id: "forecast", node: <ForecastPanel center={ctx.histCenter} bbox={ctx.histBbox} theme={ctx.theme} /> });
  }
  slides.push(...contextSlides(ctx));
  return slides;
}
