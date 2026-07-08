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
import type { AlertFeature } from "../../lib/alerts";
import type { Quake } from "../../lib/tracks/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import type { BroadcastTheme } from "./config";
import type { DeckSlide } from "./SlideDeck";
import { KIND_COLOR, isTargetedEvent } from "./kinds";
import OnAirCard from "./OnAirCard";
import TopCitiesPanel from "./TopCitiesPanel";
import ForecastPanel from "./ForecastPanel";
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
  theme: BroadcastTheme;
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

  // Country spotlight / region tour — the "now viewing" area rollup, the area's
  // top cities, and (only when there's data) an area forecast.
  if (ctx.wideCitiesBbox) {
    slides.push({
      id: "onair",
      node: <OnAirCard segment={segment} alerts={ctx.areaAlerts} quakes={ctx.areaQuakes} volcanoes={ctx.areaVolcanoes} theme={ctx.theme} />,
    });
    slides.push({ id: "topcities", node: <TopCitiesPanel bbox={ctx.wideCitiesBbox} color={color} /> });
    if (ctx.wideCitiesHasForecast) {
      slides.push({ id: "forecast", node: <ForecastPanel center={null} bbox={ctx.wideCitiesBbox} theme={ctx.theme} /> });
    }
    return slides;
  }

  // Any other wide shot — just the "now viewing" card.
  slides.push({
    id: "onair",
    node: <OnAirCard segment={segment} alerts={ctx.areaAlerts} quakes={ctx.areaQuakes} volcanoes={ctx.areaVolcanoes} theme={ctx.theme} />,
  });
  return slides;
}
