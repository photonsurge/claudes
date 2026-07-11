"use client";

/**
 * The on-air chrome overlaying the globe/map: top + bottom crawls, the brand
 * block + LIVE badge, a top-centre live-alert panel + intensity meter, a
 * top-right world-watch summary and bottom seismic/tsunami global monitors.
 *
 * Built for VIDEO, not the responsive web: the furniture is authored once at a
 * 1920×1080 design stage and scaled as a whole to the output resolution (see
 * useStageScale), so it stays pixel-proportional and crisp from 720p to 4K on
 * YouTube/OBS rather than reflowing at breakpoints. Fully pointer-inert so it
 * never intercepts the capture surface, and derives entirely from data the watch
 * surface already has (alerts, quakes, tracks, the active variable's legend).
 */
import { useMemo } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import type { Segment, SegmentKind } from "@photonsurge/shared/director";
import type { AuroraOverlay } from "../../lib/aurora-overlay";
import type { GeomagOverlay } from "../../lib/geomag-overlay";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake, Track } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import type { TideStationReading } from "../../lib/tides/types";
import type { City } from "../../lib/cities";
import type { Cam } from "../../lib/cams/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import {
  countryShot,
  countryContaining,
} from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import {
  buildTicker,
  alertTickerLines,
  scopeAlertsToBbox,
  scopeQuakesToBbox,
  scopeVolcanoesToBbox,
} from "../../lib/broadcast";
import { bboxForCamera, type HistorySeries } from "../../lib/history-client";
import { useLatestRoundup } from "../../lib/summaries";
import {
  useFocusRegion,
  useFocusCountry,
  useCountryRoundup,
  useRegionRoundup,
  useAreaForecastDays,
} from "../../lib/focus/focus-client";
import { legendVariableFor } from "../../lib/legend";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { KIND_LABEL } from "../DirectorHolds";
import { nearest, formatKm } from "../../lib/geo";
import { useWorldWatch } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import LiveAlertPanel from "./LiveAlertPanel";
import WorldReportDeck from "./WorldReportDeck";
import KpIndexPanel from "./KpIndexPanel";
import SpaceWeatherMeter from "./SpaceWeatherMeter";
import {
  SeismicMonitor,
  TsunamiMonitor,
  WeatherMonitors,
} from "./MonitorCluster";
import SeismicStationRow from "./SeismicStationRow";
import TideStationRow from "./TideStationRow";
import PointHistoryPanel from "./PointHistoryPanel";
import ForecastPanel from "./ForecastPanel";
import EventOverlay from "./EventOverlay";
import SyslogFeed from "./SyslogFeed";
import UpNextPanel from "./UpNextPanel";
import BuildInfoTag from "./BuildInfoTag";
import SlideDeck from "./SlideDeck";
import FadeSwap from "./FadeSwap";
import { useSegmentTransition } from "./useSegmentTransition";
import { modeSlides } from "./mode-slides";
import { hasRealLocation, isTargetedEvent, KIND_COLOR, KIND_LABEL as KIND_BADGE } from "./kinds";

/** Design-stage layout constants (in 1080p reference pixels). */
const TICKER_H = 34;
const INSET = 30;
const BRAND_STACK_H = 150;

/**
 * A "Nearest City" reticle row for a moving target (aircraft / ship) — the
 * segment shape carries no place name, so we name the closest notable city + its
 * distance for geographic context (mid-ocean it still names the closest
 * landfall). Empty for every other kind (quakes/storms already carry a place).
 */
function nearestCityDetails(
  segment: Segment,
  cities: City[],
): { label: string; value: string }[] {
  if (segment.kind !== "flight" && segment.kind !== "ship") return [];
  const notable = cities.filter((c) => (c.population ?? 0) > 0 || c.isCapital);
  const n = nearest(notable, segment.camera.center, (c) => [c.lng, c.lat]);
  if (!n) return [];
  const name = n.item.country
    ? `${n.item.name}, ${n.item.country}`
    : n.item.name;
  return [
    { label: "Nearest City", value: `${name} · ${formatKm(n.distanceKm)}` },
  ];
}

export default function BroadcastFrame({
  state,
  manifest,
  alerts = [],
  quakes = [],
  volcanoes = [],
  seismoStations = [],
  seismoActive = null,
  tideStations = [],
  tideActive = null,
  pointHistorySeries = [],
  tracks = [],
  cities = [],
  cams = [],
  aurora = null,
  geomag = null,
  theme = DEFAULT_THEME,
  onAirSegment = null,
  upNext = [],
  assetsReady = true,
  directorOn = false,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  /** Worker-cached active-volcano feed — for the country/region "IN VIEW" rollup. */
  volcanoes?: Volcano[];
  /** Worker-cached live seismograph stations near what's on air. */
  seismoStations?: SeismoStationReading[];
  /** Which of `seismoStations` is currently "on air" in the SEISMIC MONITOR panel. */
  seismoActive?: SeismoStationReading | null;
  /** Worker-cached tide gauges near what's on air. */
  tideStations?: TideStationReading[];
  /** Which of `tideStations` is currently "on air" in the TSUNAMI GAUGE panel. */
  tideActive?: TideStationReading | null;
  /** Archived point-history at the on-air focus, for the WIND/PRESSURE/WAVE
   *  "LOCAL MONITOR" cards. */
  pointHistorySeries?: HistorySeries[];
  tracks?: Track[];
  /** Curated cities — for the "near this event" panel. */
  cities?: City[];
  /** Worker-cached webcams — for the "near this event" panel. */
  cams?: Cam[];
  /** Cached aurora frame (carries the Kp index) — for the space-weather readout. */
  aurora?: AuroraOverlay | null;
  /** Cached geomagnetic-field frame — for the space-weather colour-key ramp. */
  geomag?: GeomagOverlay | null;
  theme?: BroadcastTheme;
  /** The on-air director segment — drives the event reticle so it matches what's
   *  actually selected. Null when nothing is on air (reticle hidden). */
  onAirSegment?: Segment | null;
  /** Director's best-guess "coming up" preview (score-ranked at the last cut,
   *  not a committed pick) — drives the small UP NEXT line by the SYSLOG feed. */
  upNext?: { kind: SegmentKind; title: string }[];
  /** True once the globe's own textures are ready (see useGlobeReadyOnce) —
   *  defers the WORLD WATCH panels' cold-start fetch so it doesn't compete with
   *  those for bandwidth while the loading screen is still up. */
  assetsReady?: boolean;
  /** Whether the auto-director is actively driving this scene — gates the
   *  brand block's LIVE badge (an idle/off director isn't on air). */
  directorOn?: boolean;
}) {
  const scale = useStageScale();
  // While the director cuts to the next shot the globe flies for
  // `state.cutTransitionMs`; hide the bottom-left deck for that window so it
  // doesn't sit frozen on the old card (or flash the new one) mid-flight, then
  // fade it back once the new shot lands.
  const cutting = useSegmentTransition(onAirSegment?.id ?? null, state.cutTransitionMs);
  const worldWatch = useWorldWatch(cities, assetsReady);
  // The alert crawl lines carry a per-alert nearest-city flag scan (the crawl's
  // one expensive step), so memoise them on JUST [alerts, cities] — otherwise the
  // dead-reckoned track feed (new array ~1×/s) would rerun the whole scan every
  // second and jam the render on a busy global feed. The final assembly is cheap.
  const alertLines = useMemo(
    () => alertTickerLines(alerts, cities),
    [alerts, cities],
  );
  const ticker = useMemo(
    () => buildTicker({ quakes, tracks, alertLines }),
    [quakes, tracks, alertLines],
  );
  // The round-up narrative rides on a `global` spin (see director.ts's
  // `Segment.summary`) — surfaced as on-air graphics (the round-up deck card),
  // NOT by hijacking the bottom crawl. Both crawls keep the standing global feed
  // throughout, so the day's live alerts/quakes/tracks stay on screen even while
  // a round-up airs.
  const summaryOnAir = onAirSegment?.summary ?? null;
  // The current global round-up, fetched independently of the segment — so the
  // plain world spins (intro/global/ocean/orbital), which carry no `summary`
  // tour of their own, still surface the live "state of the planet" narrative +
  // headline numbers as a deck slide (see mode-slides' wide-shot branch).
  const worldRoundupDoc = useLatestRoundup("hourly");
  const bottomTickerTitle = theme.tickerTitle;
  const bottomTickerItems = ticker;
  const eventTargeted = onAirSegment
    ? isTargetedEvent(onAirSegment.kind)
    : false;
  // Top-left operator readout: the on-air shot (its kind + the specific target it
  // framed, e.g. AIRCRAFT · Air Force One) and which weather attribute is painted.
  const brandStatus = {
    shotKind: onAirSegment ? KIND_LABEL[onAirSegment.kind] : null,
    shotTarget: onAirSegment ? onAirSegment.title : null,
    attribute: state.activeVariable
      ? (VARIABLE_REGISTRY[state.activeVariable]?.label ?? state.activeVariable)
      : null,
  };
  // Global spins (intro/global/ocean/orbital) frame an arbitrary point, not a real
  // ground location — the weather/climate history panel has nothing to sample.
  const segmentHasLocation = onAirSegment
    ? hasRealLocation(onAirSegment.kind)
    : true;
  // A notable aircraft/ship carries a rich Track Info card on the segment; when
  // present it takes the bottom-left slot (superseding the nearby-cities panel).
  const hasTrackInfo = onAirSegment?.trackInfo != null;
  // Space-weather readout rides on the aurora overlay: only when the oval is on
  // and the cached frame actually carries a Kp reading.
  const kpShown = state.showAurora && aurora?.meta.kp != null;
  // Colour-key ramp for the aurora oval / magnetic field — both hooks already
  // return null when their toggle is off, so presence alone gates this.
  const spaceWeatherShown = aurora?.meta != null || geomag?.meta != null;
  // A country spotlight scopes the global alerts/quakes feeds down to its own
  // bbox (`shared/director-countries`); a weather-check segment has no fixed
  // bbox but does sit on a real ground location, so it gets the
  // same treatment via the camera's own framing (see bboxForCamera) — without
  // this, every wide shot but "country" showed the same whole-planet "IN VIEW"
  // tally no matter what was actually on screen.
  // Segment ids are "kind:subject" (see worker's `make()`), so a country
  // segment's id is e.g. "country:portugal" — the catalog is keyed by the
  // bare subject.
  const countryOnAir =
    onAirSegment?.kind === "country"
      ? countryShot(onAirSegment.id.split(":")[1] ?? "")
      : undefined;
  // A region ("area") spotlight is the Region-catalog cousin of the country
  // shot: same "kind:subject" id (e.g. "region:sahel"), framed + scoped off the
  // region's bbox (shared/director-regions), and given the same wide-shot deck.
  const regionId =
    onAirSegment?.kind === "region" ? (onAirSegment.id.split(":")[1] ?? null) : null;
  const regionOnAir = regionId ? regionShot(regionId) : undefined;
  // The enriched Region doc (wiki photo/blurb) for the lede's area block —
  // regions have no polygon, so this is a direct regionId fetch, not point-in-
  // polygon like the country lookup. Null off a region shot / before enrichment.
  const regionDoc = useFocusRegion();
  // A round-up tours a fresh hotspot every few seconds by patching `state.camera`
  // to that stop's centre (see director.ts's summary cutSteps) — the segment's
  // own `camera` field stays pinned to the base global framing the whole time,
  // so scoping off of it would tally the whole planet no matter which stop is
  // currently shown. `state.camera` is the one place that actually tracks the
  // live stop. When that stop lands inside a curated country, tally against its
  // real bbox (exactly like a country spotlight) instead of a camera-zoom guess.
  const summaryCountry =
    onAirSegment?.summary
      ? countryContaining(state.camera.center[0], state.camera.center[1])
      : undefined;
  // The enriched Country doc under the on-air point — from the full ~240-country
  // Mongo catalog (real boundaries), unlike the ~30 curated `countryContaining`
  // above. Resolved once and reused for two things: the round-up's "the nation"
  // card AND the uniform lede's "area" photo/blurb that EVERY mode's first slide
  // now carries. A round-up tracks the moving stop (state.camera.center); any
  // other located shot uses the segment's own centre; wide/oceanic/orbital shots
  // have no ground point → null. Scoping (cities/alerts) still uses the framed
  // bbox below so an archipelago nation's Pacific territories don't drag cities
  // in from the far side of the planet.
  const ledeCenter: [number, number] | null = !onAirSegment
    ? null
    : onAirSegment.summary
      ? state.camera.center
      : segmentHasLocation
        ? (onAirSegment.camera.center ?? state.camera.center ?? null)
        : null;
  const ledeCountryDoc = useFocusCountry(ledeCenter);
  const summaryCountryDoc = onAirSegment?.summary ? ledeCountryDoc : null;
  // The framed place's own per-place round-up — the spotlight's second slide.
  // A country shot keys on the enriched Country under the on-air point
  // (`ledeCountryDoc.countryId`, the id the place-roundups worker writes against);
  // a region shot keys directly on its `regionId`. One hook, kind switches; it
  // returns null (→ no slide) until a round-up exists for that place.
  // Both roundup selectors run every render (React hook rules); pick by kind to
  // preserve the exact region→region / country→country / else→null semantics.
  // The selectors serve the one /api/focus bundle when it covers this shot, else
  // fall back to a live /api/roundup/place fetch keyed on the resolved place id.
  const regionRoundup = useRegionRoundup();
  const countryRoundup = useCountryRoundup();
  const placeRoundup =
    onAirSegment?.kind === "region"
      ? regionRoundup
      : onAirSegment?.kind === "country"
        ? countryRoundup
        : null;
  // The lede's "area" photo/blurb: a region shot reads its own enriched Region
  // doc (no polygon country under it to resolve); every other located shot uses
  // the enriched Country under the on-air point.
  const areaInfo =
    onAirSegment?.kind === "region"
      ? regionDoc
        ? {
            name: regionDoc.name,
            photo: regionDoc.wikiThumb ?? regionDoc.wikiPhoto ?? null,
            blurb: regionDoc.wikiExtract ?? null,
          }
        : null
      : ledeCountryDoc
        ? {
            name: ledeCountryDoc.name,
            photo: ledeCountryDoc.wikiThumb ?? ledeCountryDoc.wikiPhoto ?? null,
            blurb: ledeCountryDoc.wikiExtract ?? null,
            iso2: ledeCountryDoc.iso2,
          }
        : null;
  // Scope the on-air feeds to the framed area for the lede rollup — including
  // targeted events (a small box around the epicentre/storm), so a quake's lede
  // tallies nearby activity rather than the whole planet.
  const areaBbox = countryOnAir
    ? countryOnAir.bbox
    : regionOnAir
      ? regionOnAir.bbox
      : summaryCountry
      ? summaryCountry.bbox
      : onAirSegment?.summary
        ? bboxForCamera(state.camera.center, state.camera.zoom)
        : onAirSegment && segmentHasLocation
          ? bboxForCamera(onAirSegment.camera.center, onAirSegment.camera.zoom)
          : undefined;
  const areaAlerts = areaBbox ? scopeAlertsToBbox(alerts, areaBbox) : alerts;
  const areaQuakes = areaBbox ? scopeQuakesToBbox(quakes, areaBbox) : quakes;
  const areaVolcanoes = areaBbox
    ? scopeVolcanoesToBbox(volcanoes, areaBbox)
    : volcanoes;

  // A country spotlight scopes the "IN VIEW" roundup + "TOP CITIES" info to this
  // framed area — set here so mode-slides can turn them into the wide-shot deck
  // (they'd overflow the frame stacked, so the deck rotates them instead). Only
  // when the shot has a real framed area (not a targeted point or a
  // notable-track segment).
  const wideCitiesBbox =
    onAirSegment &&
    !eventTargeted &&
    !hasTrackInfo &&
    (onAirSegment.kind === "country" ||
      onAirSegment.kind === "region" ||
      onAirSegment.summary != null)
      ? areaBbox
      : undefined;
  // Whether the country area forecast has data — decides if it earns its
  // own slide in the deck (see mode-slides). ForecastPanel re-fetches the same
  // (rounded, Cache-Control: max-age=60) URL when it mounts as that slide; the
  // duplicate call is cheap and one-time per bbox change.
  const wideCitiesForecast = useAreaForecastDays(wideCitiesBbox ?? null);
  const wideCitiesHasForecast = wideCitiesForecast.days.length > 0;

  // Focus point + framed bbox for the WEATHER (forecast) and CURRENT & RECENT
  // (AREA HISTORY) context slides — the on-air centre, or the operator camera
  // when the segment carries none; null on shots with no real ground location.
  const histCenter = segmentHasLocation
    ? (onAirSegment?.camera.center ?? state.camera.center ?? null)
    : null;
  const histBbox = segmentHasLocation
    ? bboxForCamera(
        onAirSegment?.camera.center ?? state.camera.center,
        onAirSegment?.camera.zoom ?? state.camera.zoom,
      )
    : null;
  // A plain (non-country) wide shot's framed-area forecast, gated on real data so
  // the deck never rotates onto an empty weather slide — country shots use
  // wideCitiesForecast instead. Keyed on the bbox, so it only refetches on a cut.
  const framedForecast = useAreaForecastDays(!wideCitiesBbox ? histBbox : null);
  const hasFramedForecast = framedForecast.days.length > 0;
  // Sea-temp-by-depth rides ocean scenes only; same null-on-no-location rule as
  // the history panel it sat beside before.
  const depthCenter = onAirSegment?.kind === "ocean" ? histCenter : null;

  // The bottom-left mode deck: one ordered, content-filtered slide list per
  // segment kind (mode-slides), replacing the old nested-ternary +
  // usePagedSlides page bookkeeping. SlideDeck cross-fades through it and keeps
  // every slide mounted, preserving each panel's own featured-city cycle /
  // fetched data across a rotation. Every left-column card — the mode cards AND
  // the weather / area-history / depth / round-up context cards — is a slide in
  // this one deck now, so the column is a single tidy rotating card per mode
  // instead of a tall stack.
  const leftDeck = onAirSegment
    ? modeSlides(onAirSegment, {
        cities,
        cams,
        quakes,
        alerts,
        areaAlerts,
        areaQuakes,
        areaVolcanoes,
        wideCitiesBbox,
        wideCitiesHasForecast,
        histCenter,
        histBbox,
        segmentHasLocation,
        hasFramedForecast,
        showDepth: onAirSegment.kind === "ocean",
        depthCenter,
        manifest,
        activeVariable: state.activeVariable,
        roundup: summaryOnAir
          ? { narrative: summaryOnAir.narrative, stats: summaryOnAir.stats, sources: summaryOnAir.sources }
          : undefined,
        worldRoundup: worldRoundupDoc
          ? {
              narrative: worldRoundupDoc.narrative,
              stats: worldRoundupDoc.stats,
              sources: worldRoundupDoc.sources,
            }
          : undefined,
        summaryCountry: summaryCountryDoc,
        placeRoundup,
        areaInfo,
        theme,
      })
    : [];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 5,
      }}
    >
      {/* 1080p design stage, uniformly scaled + centred to the output resolution. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Targeted point events (storm/quake/aircraft/ship/volcano) get the
            centred reticle + lower-third; the readouts that used to float off
            its corners are anchored to the screen edges instead — tracking
            detail top-left under the brand, point-history out on the right,
            forecast down in the bottom-right (see the bottom-right column). Wide
            shots (global/ocean/region/…) keep their lower-left card stack. */}
        {onAirSegment && isTargetedEvent(onAirSegment.kind) ? (
          <EventOverlay
            segment={onAirSegment}
            extraDetails={nearestCityDetails(onAirSegment, cities)}
            theme={theme}
            historyPanel={
              segmentHasLocation ? (
                <PointHistoryPanel
                  center={onAirSegment.camera.center}
                  theme={theme}
                  compact
                />
              ) : null
            }
            forecastPanel={
              segmentHasLocation ? (
                <ForecastPanel
                  center={onAirSegment.camera.center}
                  theme={theme}
                  compact
                />
              ) : null
            }
          />
        ) : null}

        {/* Bottom-left column: the archived history charts for the focus, stacked
            above whichever context card currently owns the bottom-left slot (the
            wide-shot "now viewing" card, a Track Info card for a notable
            aircraft/ship, or the targeted-event quake/nearby-cities report — all
            mutually exclusive on segment kind). column-reverse anchors the
            context card to the bottom edge regardless of the history panel's
            (self-hiding, variable-height) content. Only shown for wide (non-
            targeted) shots — targeted events carry their own compact copy in
            the EventOverlay reticle above instead. */}
        <div
          style={{
            position: "absolute",
            left: INSET,
            bottom: TICKER_H + INSET,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          {/* One rotating card per mode: the mode cards plus the weather /
              area-history / depth / round-up context slides all live in this
              deck now (see mode-slides), so nothing stacks below it. Targeted
              events carry their own compact history in the EventOverlay reticle
              above instead of a left-column card.

              FadeSwap smoothly fades the card out for the cut (holding the old
              card's content through the fade, swapping to the new segment behind
              the black) and fades it back once the globe settles. */}
          <FadeSwap hidden={cutting} style={{ display: "flex" }}>
            {onAirSegment ? (
              <SlideDeck
                slides={leftDeck}
                dotColor={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"}
                chrome={{
                  badge: KIND_BADGE[onAirSegment.kind] ?? onAirSegment.kind,
                  badgeColor: KIND_COLOR[onAirSegment.kind],
                  title: onAirSegment.title,
                  accent: KIND_COLOR[onAirSegment.kind],
                }}
              />
            ) : null}
          </FadeSwap>
        </div>

        <Ticker
          title={theme.tickerTitle}
          items={ticker}
          edge="top"
          height={TICKER_H}
          theme={theme}
        />

        <div
          style={{ position: "absolute", top: TICKER_H + 12, left: -4 }}
        >
          <BrandPanel theme={theme} live={directorOn} status={brandStatus} />
        </div>

        {/* Geomagnetic Kp readout, tucked under the brand block when the aurora
            overlay is on; pushes the intensity meter down so they don't overlap. */}
        {kpShown ? (
          <div
            style={{
              position: "absolute",
              top: TICKER_H + 12 + BRAND_STACK_H,
              left: -4,
            }}
          >
            <KpIndexPanel kp={aurora?.meta.kp} theme={theme} />
          </div>
        ) : null}

        {/* Top-centre column: single most-severe active alert, stacked above the
            active variable's intensity meter/legend, then the space-weather
            colour key (aurora oval / magnetic field) — all the on-air colour
            legends live together here, horizontal, so the prime top-right slot
            can carry the always-on WORLD WATCH summary instead. Each hides
            independently when it has nothing to show. */}
        <div
          style={{
            position: "absolute",
            top: TICKER_H + INSET,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <LiveAlertPanel alerts={alerts} cities={cities} theme={theme} />
          <IntensityMeter
            variable={legendVariableFor(state)}
            units={state.units}
            theme={theme}
            showSatImg={state.showSatImg}
            satImgFeeds={state.satImgFeeds}
          />
          {spaceWeatherShown ? (
            <SpaceWeatherMeter aurora={aurora} geomag={geomag} theme={theme} />
          ) : null}
        </div>

        {/* Whole-planet situation summary — a static stack (no mode-to-mode
            cycling): the latest hourly WORLD REPORT on top, then the ACTIVE
            ALERTS drill-down. Independent of the operator's show-alerts/seismic
            toggles — it reuses the one worldWatch fetch (above) rather than each
            panel pulling its own. */}
        <div
          style={{
            position: "absolute",
            top: TICKER_H + INSET,
            right: INSET - 12,
          }}
        >
          <WorldReportDeck
            worldWatch={worldWatch}
            manifest={manifest}
            theme={theme}
          />
        </div>

        {/* Bottom-right column: UP NEXT hint, the SYSLOG feed, and the build
            stamp anchored beneath both. column-reverse anchors the first child
            (BuildInfoTag) to the bottom edge, with SYSLOG then UP NEXT
            stacking upward above it. */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            right: INSET,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <BuildInfoTag />
          <SyslogFeed />
          <UpNextPanel items={upNext} />
        </div>

        {/* Bottom-centre row: seismic monitor column, the extra weather-
            instrument cards (wind/pressure/wave), then the tsunami gauge
            column — all anchored to the same bottom edge (alignItems:
            flex-end + column-reverse) so any of them can grow upward
            independently without disturbing the others' baseline. The gauges
            row (NEARBY TSUNAMI GAUGES) sits closest to the bottom edge in its
            column; the GLOBAL MONITOR tsunami card only appears above it when
            there's a single gauge in range (it hides itself once the row has
            2+, to avoid showing the same gauge twice). */}
        <div
          style={{
            position: "absolute",
            bottom: TICKER_H + INSET,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column-reverse",
              alignItems: "center",
              gap: 10,
            }}
          >
            <SeismicMonitor
              quakes={quakes}
              seismoStations={seismoStations}
              seismoActive={seismoActive}
              onAirSegment={onAirSegment}
              regionCenter={state.camera.center}
              theme={theme}
            />
            <SeismicStationRow
              stations={seismoStations}
              onAirSegment={onAirSegment}
              theme={theme}
            />
          </div>
          <WeatherMonitors
            series={pointHistorySeries}
            locationLabel={
              onAirSegment && segmentHasLocation ? onAirSegment.title : null
            }
            theme={theme}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column-reverse",
              alignItems: "center",
              gap: 10,
            }}
          >
            <TideStationRow stations={tideStations} theme={theme} />
            <TsunamiMonitor
              stations={tideStations}
              active={tideActive}
              theme={theme}
            />
          </div>
        </div>

        <Ticker
          title={bottomTickerTitle}
          items={bottomTickerItems}
          edge="bottom"
          height={TICKER_H}
          theme={theme}
        />
      </div>
    </div>
  );
}
