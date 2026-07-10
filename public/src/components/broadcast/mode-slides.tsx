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
import type { AlertFeature } from "../../lib/alerts";
import type { Quake } from "../../lib/tracks/types";
import type { City } from "../../lib/cities";
import type { CountryAt } from "../../lib/countries";
import type { Cam } from "../../lib/cams/types";
import type { BroadcastTheme } from "./config";
import type { DeckSlide } from "./SlideDeck";
import { KIND_COLOR, isTargetedEvent } from "./kinds";
import OnAirCard from "./OnAirCard";
import CountryPanel from "./CountryPanel";
import AreaAlertsPanel from "./AreaAlertsPanel";
import TopCitiesPanel from "./TopCitiesPanel";
import ForecastPanel from "./ForecastPanel";
import PointHistoryPanel from "./PointHistoryPanel";
import DepthProfilePanel from "./DepthProfilePanel";
import RoundupStatsPanel from "./RoundupStatsPanel";
import QuakeReport from "./QuakeReport";
import EventNearbyPanel from "./EventNearbyPanel";
import TrackInfoPanel from "./TrackInfoPanel";
import VolcanoFactsPanel, { volcanoFactsSlideHasContent } from "./VolcanoFactsPanel";
import VolcanoNearbyPanel, { volcanoNearbySlideHasContent } from "./VolcanoNearbyPanel";

const FALLBACK_ACCENT = "#38bdf8";

export interface ModeSlideContext {
  /** Curated cities — for the quake/event "cities near" + volcano nearby slides. */
  cities: City[];
  /** Worker-cached webcams — for the "near this event" slide. */
  cams: Cam[];
  /** Full global feeds — for the volcano "what else is nearby" content guard. */
  quakes: Quake[];
  alerts: AlertFeature[];
  /** Feeds already scoped to the on-air area — for the OnAirCard rollup. */
  areaAlerts: AlertFeature[];
  areaQuakes: Quake[];
  areaVolcanoes: Volcano[];
  /** Set for a country spotlight / region tour — enables the TOP CITIES +
   *  area-forecast slides (bbox the framed area was scoped to). */
  wideCitiesBbox?: [number, number, number, number];
  /** Whether the area forecast has data — decides if the forecast slide shows
   *  (computed in BroadcastFrame since it needs a hook). */
  wideCitiesHasForecast: boolean;
  /** Focus point / framed bbox for the WEATHER (forecast) + CURRENT & RECENT
   *  (AREA HISTORY) + ocean-depth slides. Folded into the deck so the left
   *  column is ONE rotating card per mode instead of a tall stack. */
  histCenter: [number, number] | null;
  histBbox: [number, number, number, number] | null;
  /** Whether the on-air kind sits on a real ground location — gates the AREA
   *  HISTORY slide (global/orbital/intro shots have nothing to sample). */
  segmentHasLocation: boolean;
  /** A plain (non-region) wide shot's framed-area forecast has data — gates its
   *  weather slide (region/tour use wideCitiesHasForecast instead). */
  hasFramedForecast: boolean;
  /** Ocean scene — offers the sea-temp-by-depth slide. */
  showDepth: boolean;
  depthCenter: [number, number] | null;
  manifest: WeatherManifest | null;
  activeVariable: string | null;
  /** Round-up narrative stats — folds the summary mode's stats card into the
   *  deck rather than stacking it below. */
  roundup?: { stats?: iSummaryStats; sources?: string[] };
  /** The enriched country the round-up tour is currently parked on (resolved
   *  per stop via /api/countries/at) — drives the summary deck's "the nation"
   *  card. Null when the stop is over ocean / outside every country. */
  summaryCountry?: CountryAt | null;
  theme: BroadcastTheme;
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
    out.push({ id: "history", node: <PointHistoryPanel center={ctx.histCenter} bbox={ctx.histBbox} theme={ctx.theme} /> });
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

/** The mode's ordered, content-filtered deck. Caller guards `segment` non-null. */
export function modeSlides(segment: Segment, ctx: ModeSlideContext): DeckSlide[] {
  const color = KIND_COLOR[segment.kind] ?? FALLBACK_ACCENT;
  const slides: DeckSlide[] = [];

  // Notable aircraft / ship / volcano — the rich Track Info card, plus the two
  // extra volcano pages whenever they carry content.
  if (segment.trackInfo != null) {
    slides.push({ id: "track", node: <TrackInfoPanel segment={segment} color={color} /> });
    if (segment.kind === "volcano") {
      if (volcanoFactsSlideHasContent(segment.trackInfo)) {
        slides.push({ id: "volcano-facts", node: <VolcanoFactsPanel info={segment.trackInfo} color={color} /> });
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

  // Targeted point event (storm / quake / …) — the seismic breakdown (quakes
  // only) then the "who's affected / cities near" enrichment.
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
    slides.push({
      id: "nearby",
      node: <EventNearbyPanel center={segment.camera.center} cities={ctx.cities} cams={ctx.cams} color={color} />,
    });
    return slides;
  }

  // Round-up — a per-country package that plays while the tour dwells on each
  // stop: the "now viewing" IN VIEW rollup (alerts/quakes/volcanoes), then the
  // nation itself (flag/photo/blurb), its area forecast (country weather), its
  // active-alerts drill-down, its capital + top cities (each with climate
  // charts), and the round-up's own headline numbers. Every country-scoped slide
  // guards on real content so an ocean/uncurated stop degrades to just the
  // rollup + stats. `wideCitiesBbox` is the enriched country's real bbox here
  // (set for summary in BroadcastFrame), so the cities/forecast reuse the same
  // plumbing the country spotlight does.
  if (segment.kind === "summary") {
    slides.push({
      id: "onair",
      node: <OnAirCard segment={segment} alerts={ctx.areaAlerts} quakes={ctx.areaQuakes} volcanoes={ctx.areaVolcanoes} theme={ctx.theme} />,
    });
    if (ctx.summaryCountry) {
      slides.push({ id: "nation", node: <CountryPanel country={ctx.summaryCountry} color={color} theme={ctx.theme} /> });
    }
    if (ctx.wideCitiesBbox && ctx.wideCitiesHasForecast) {
      slides.push({ id: "forecast", node: <ForecastPanel center={null} bbox={ctx.wideCitiesBbox} theme={ctx.theme} /> });
    }
    if (ctx.areaAlerts.length) {
      slides.push({ id: "alerts", node: <AreaAlertsPanel alerts={ctx.areaAlerts} color={color} theme={ctx.theme} /> });
    }
    if (ctx.wideCitiesBbox) {
      slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    }
    if (ctx.roundup) {
      slides.push({ id: "roundup", node: <RoundupStatsPanel stats={ctx.roundup.stats} sources={ctx.roundup.sources} theme={ctx.theme} /> });
    }
    return slides;
  }

  // Country spotlight / region tour — reads START → CITIES → WEATHER → CURRENT &
  // RECENT: the "now viewing" area rollup, the area's close cities, the area
  // forecast (when it has data), then the AREA HISTORY trend charts.
  if (ctx.wideCitiesBbox) {
    slides.push({
      id: "onair",
      node: <OnAirCard segment={segment} alerts={ctx.areaAlerts} quakes={ctx.areaQuakes} volcanoes={ctx.areaVolcanoes} theme={ctx.theme} />,
    });
    slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    if (ctx.wideCitiesHasForecast) {
      slides.push({ id: "forecast", node: <ForecastPanel center={null} bbox={ctx.wideCitiesBbox} theme={ctx.theme} /> });
    }
    slides.push(...contextSlides(ctx));
    return slides;
  }

  // Any other wide shot (intro / global / ocean / orbital) — the "now viewing"
  // card (START), then the same WEATHER → CURRENT & RECENT context slides.
  slides.push({
    id: "onair",
    node: <OnAirCard segment={segment} alerts={ctx.areaAlerts} quakes={ctx.areaQuakes} volcanoes={ctx.areaVolcanoes} theme={ctx.theme} />,
  });
  if (ctx.hasFramedForecast) {
    slides.push({ id: "forecast", node: <ForecastPanel center={ctx.histCenter} bbox={ctx.histBbox} theme={ctx.theme} /> });
  }
  slides.push(...contextSlides(ctx));
  return slides;
}
