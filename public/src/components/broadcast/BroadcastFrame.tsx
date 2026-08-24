"use client";

/**
 * The on-air chrome overlaying the globe/map: the bottom crawl, the brand
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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import type { Segment, UpNextItem } from "@photonsurge/shared/director";
import type { AuroraOverlay } from "../../lib/aurora-overlay";
import type { GeomagOverlay } from "../../lib/geomag-overlay";
import type { AlertFeature } from "../../lib/alerts";
import type { HazardType } from "../../lib/hazard";
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
  scopeAlertsToRadius,
  scopeQuakesToRadius,
  scopeVolcanoesToRadius,
} from "../../lib/broadcast";
import { bboxForCamera, type HistorySeries } from "../../lib/history-client";
import { useLatestRoundup } from "../../lib/summaries";
import {
  useFocusRegion,
  useFocusCountry,
  useCountryRoundup,
  useRegionRoundup,
  useRegionCountries,
  useRegionNearTerm,
  useAreaForecastDays,
  useAlertTimeline,
  useAlertSnapshots,
  useAlertResources,
  useAlertSeries,
  useEventTimeline,
  useEventSnapshots,
  useEventResources,
  useEventSeries,
  useNearbyCams,
  useVolcanoMedia,
  useVolcanoCams,
  useVolcanoEruptions,
  useFocusTarget,
} from "../../lib/focus/focus-client";
import { legendVariableFor, legendPaletteFor } from "../../lib/legend";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { KIND_LABEL } from "../../lib/kind-labels";
import { nearest, formatKm } from "../../lib/geo";
import { useWorldWatch } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { useStageScale, STAGE_W, STAGE_H } from "./useStageScale";
import Ticker from "./Ticker";
import BrandPanel from "./BrandPanel";
import IntensityMeter from "./IntensityMeter";
import WorldClockStrip from "./WorldClockStrip";
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
import { mapFreshness } from "../../lib/manifest";
import EventOverlay, { EventTrackingLabel, trackingBlockHeight } from "./EventOverlay";
import { CARD_H } from "./BroadcastCard";
import { flagEmoji } from "./RegionCountryPanel";
import SyslogFeed from "./SyslogFeed";
import SubGlobeWidget from "./SubGlobeWidget";
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
/** Design height of the brand block (banner + the LIVE/status strip) — the
 *  clocks that used to pad this out now ride the masthead map plate. */
const BRAND_STACK_H = 136;
/** The masthead brand block sits at the very top-left, scaled up for
 *  legibility. There is no top crawl any more — the map title/details row
 *  rides the full masthead strip to the right of the logo. */
const BRAND_TOP = 4;
const BRAND_SCALE = 1.5;
/** Left edge of the masthead title band (the active-map hero + source chip):
 *  just past the scaled banner's right edge (banner is 620 design px wide at
 *  left -4 → ~926 scaled). */
const BRAND_INSET = 940;
/** Scaled bottom edge of the masthead banner PNG (1951×294 source at 620
 *  design px wide → ~93 px tall, ×1.5, +BRAND_TOP ≈ 144) — the masthead
 *  title row ends at this edge, so the chrome below hangs off it. */
const BANNER_BOTTOM = 144;

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

/** Readable condition label for the reticle weather line. */
const CONDITION_LABEL: Record<string, string> = {
  sunny: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  snow: "Snow",
  storm: "Storm",
};

export default function BroadcastFrame({
  state,
  manifest,
  alerts = [],
  activeHazard = null,
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
  focusCaption = null,
  upNext = [],
  assetsReady = true,
  directorOn = false,
}: {
  state: ControlState;
  manifest: WeatherManifest | null;
  alerts?: AlertFeature[];
  /** The hazard type the globe is lighting right now (lib/alert-cycle) — the
   *  IN VIEW rollup marks it so the card names what the map is showing. */
  activeHazard?: HazardType | null;
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
  /** Current Areas-tour stop caption (city + country) — drives the centre place
   *  reticle while the left card keeps naming the area. Null off a tour. */
  focusCaption?: { title: string; subtitle: string } | null;
  /** Director's best-guess "coming up" preview (score-ranked at the last cut,
   *  not a committed pick) — drives the small UP NEXT line by the SYSLOG feed. */
  upNext?: UpNextItem[];
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
  // Opt-in diagnostic (append `?dbg` to the /watch URL): shows what actually
  // flips between tour stops — the on-air segment id and the `cutting` (deck-fade)
  // flag. If `cutting` blinks true as the camera flies between countries, the
  // fade is a real cut; if it stays false, the fade is coming from elsewhere.
  // Set client-side (post-mount) so it never causes an SSR hydration mismatch.
  const [dbg, setDbg] = useState(false);
  useEffect(() => {
    setDbg(new URLSearchParams(window.location.search).has("dbg"));
  }, []);
  const worldWatch = useWorldWatch(cities, assetsReady, {
    kindsOff: state.reportKindsOff,
    hazardsOff: state.reportHazardsOff,
  });
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
  // NOT by hijacking the bottom crawl. The crawl keeps the standing global feed
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
  const legendVariable = legendVariableFor(state);
  const legendPalette = legendPaletteFor(state);
  const mapMeta = mapFreshness(manifest, legendVariable, Date.now());
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
  // Per-channel chrome-widget off-list (see shared/broadcast-widgets). Each
  // optional widget below is wrapped in `!off.has("<id>")`; empty = show all.
  const off = new Set<string>(state.widgetsOff);
  // Brand on: the chrome below (centre legends, WORLD WATCH) hangs off the
  // masthead banner's bottom edge. Brand off: nothing rides the top edge (the
  // top crawl is gone), so it hangs off the screen edge itself.
  const brandOn = !off.has("brand");
  const chromeTop = (brandOn ? BANNER_BOTTOM : 0) + INSET;
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
  // Region spotlight per-country + near-term forecasts — composed onto the focus
  // bundle (bundle-only; empty off a region shot), so the region deck's country
  // slides + NEXT 24H card render without any per-country fetch at cut time.
  const regionCountries = useRegionCountries();
  const regionNearTerm = useRegionNearTerm();
  // The on-air storm's change timeline + imagery/resources/series — all served on
  // the same focus bundle (no extra per-cut requests).
  const alertTimeline = useAlertTimeline();
  const alertSnapshots = useAlertSnapshots();
  const alertResources = useAlertResources();
  const alertSeries = useAlertSeries();
  // Unified cross-source event dossier (superset) — same focus bundle.
  const eventTimeline = useEventTimeline();
  const eventSnapshots = useEventSnapshots();
  const eventResources = useEventResources();
  const eventSeries = useEventSeries();
  // Volcano dossier — all from the same focus bundle (never a per-cut fetch).
  // `volcanoCams` is ACTIVE-only and already joined to our locally-stored frame,
  // so air serves our own bytes rather than hot-linking the provider.
  const volcanoCams = useVolcanoCams();
  const volcanoMedia = useVolcanoMedia();
  const volcanoEruptions = useVolcanoEruptions();
  const focusTarget = useFocusTarget();
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
  // A single tracked event (quake / volcano / storm / aircraft / vessel) has no
  // meaningful area, so its "IN VIEW" rollup scopes by a fixed great-circle
  // radius (EVENT_SCOPE_RADIUS_KM) around the framed point — NOT the camera box,
  // which grew with the zoom and let a tight shot of one volcano still tally
  // every other volcano across the country. Country / region / summary shots
  // keep their real bbox below (the country's / area's own extent).
  const eventCenter: [number, number] | null =
    eventTargeted && onAirSegment ? onAirSegment.camera.center : null;
  // On a targeted-event shot the framed subject IS the headline (its own card
  // above), so it must NOT re-count itself in the "NEARBY" rollup — a lone erupting
  // volcano was tallying "1 volcanic", a quake shot "1 seismic". Segment ids are
  // `${kind}:${subject}` (worker's make()), and that bare subject equals the feed's
  // own id: a volcano's `v.id`, a quake's USGS `q.id`, a storm's `${source}:${identifier}`.
  const eventSubjectId =
    eventCenter && onAirSegment ? onAirSegment.id.slice(onAirSegment.kind.length + 1) : null;
  // Scope the on-air feeds to the framed area for the lede rollup. A country /
  // region / summary shot uses its own bbox; any other located wide shot (a
  // weather check) uses the camera framing.
  const areaBbox = countryOnAir
    ? countryOnAir.bbox
    : regionOnAir
      ? regionOnAir.bbox
      : summaryCountry
      ? summaryCountry.bbox
      : onAirSegment?.summary
        ? bboxForCamera(state.camera.center, state.camera.zoom)
        : onAirSegment && segmentHasLocation && !eventCenter
          ? bboxForCamera(onAirSegment.camera.center, onAirSegment.camera.zoom)
          : undefined;
  const areaAlerts = eventCenter
    ? scopeAlertsToRadius(alerts, eventCenter).filter(
        (a) => `${a.properties.source}:${a.properties.identifier}` !== eventSubjectId,
      )
    : areaBbox
      ? scopeAlertsToBbox(alerts, areaBbox)
      : alerts;
  const areaQuakes = eventCenter
    ? scopeQuakesToRadius(quakes, eventCenter).filter((q) => q.id !== eventSubjectId)
    : areaBbox
      ? scopeQuakesToBbox(quakes, areaBbox)
      : quakes;
  const areaVolcanoes = eventCenter
    ? scopeVolcanoesToRadius(volcanoes, eventCenter).filter((v) => v.id !== eventSubjectId)
    : areaBbox
      ? scopeVolcanoesToBbox(volcanoes, areaBbox)
      : volcanoes;

  // A plain world/ocean/global spin has NO framed area (not a country/region/
  // summary, not a targeted event), so `areaBbox` above is undefined and the
  // "IN VIEW" rollup fell through to the ENTIRE global feed — a meaningless flat
  // count ("545 alerts") slapped with "IN VIEW" on a shot where everything is in
  // view. On those shots hand OnAirCard the authoritative world tally so the lede
  // reads "WORLDWIDE" and breaks the count down by continent instead. Framed shots
  // (their own bbox) and targeted events (radius) keep their scoped rollup.
  const worldwide = !!onAirSegment && !areaBbox && !eventCenter;

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
  // A COUNTRY spotlight additionally scopes its cities by ISO code, so the CITIES
  // / FORECAST slides show the nation's own biggest cities rather than whatever
  // fell inside the (mainland-only, unscoped) bbox — the neighbour-bleed fix.
  // Region + round-up shots span countries, so they keep the bbox scoping.
  const wideCitiesCc =
    wideCitiesBbox && onAirSegment?.kind === "country" ? countryOnAir?.iso2 : undefined;
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
  // the deck never rotates onto an empty weather slide — country/region/summary
  // shots use the per-city CityForecastPanel slide instead. Keyed on the bbox, so
  // it only refetches on a cut.
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
        activeHazard,
        volcanoCams,
        volcanoMedia,
        volcanoEruptions,
        volcano: focusTarget?.kind === "volcano" ? focusTarget.volcano : undefined,
        alertTimeline,
        alertSnapshots,
        alertResources,
        alertSeries,
        eventTimeline,
        eventSnapshots,
        eventResources,
        eventSeries,
        areaAlerts,
        areaQuakes,
        areaVolcanoes,
        world: worldwide ? worldWatch : null,
        wideCitiesBbox,
        wideCitiesCc,
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
        region: regionDoc,
        regionCountries,
        regionNearTerm,
        theme,
        slidesOff: state.slidesOff,
        slideOrder: state.slideOrder,
        pointVarsOff: state.pointVarsOff,
      })
    : [];

  // Areas (region) tour: the camera parks each stop on a country's biggest in-
  // region city — the EXACT point regionCountries sampled its forecast at — so
  // match the moving camera centre to a bundle country and surface that stop's
  // CURRENT weather on the reticle. Fetch-free (the data's already on the focus
  // bundle), so it respects the reticle's no-per-stop-fetch guardrail.
  const tourStopWeather = useMemo(() => {
    if (onAirSegment?.kind !== "region" || !regionCountries.length) return null;
    const [clng, clat] = state.camera.center;
    let best: (typeof regionCountries)[number] | null = null;
    let bestD = Infinity;
    for (const c of regionCountries) {
      const d = Math.abs(c.lng - clng) + Math.abs(c.lat - clat);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    // Only when the camera is actually parked on a known stop (coords match the
    // sample city). Beyond ~1° it's between stops / on an uncovered country.
    if (!best || bestD > 1) return null;
    const now = best.steps.find((s) => s.temp != null) ?? best.steps[0];
    if (now?.temp == null) return null;
    // Upcoming: hi/lo over the next 24h of the same 3-hourly track.
    const soon = Date.now() + 24 * 3600_000;
    const upcomingTemps = best.steps
      .filter((s) => new Date(s.t).getTime() <= soon && s.temp != null)
      .map((s) => s.temp as number);
    const hi = upcomingTemps.length ? Math.max(...upcomingTemps) : null;
    const lo = upcomingTemps.length ? Math.min(...upcomingTemps) : null;
    return { temp: now.temp, condition: now.condition as string, cc: best.cc, hi, lo, days: best.days };
  }, [onAirSegment?.kind, regionCountries, state.camera.center]);

  // The reticle's tracking readout — folded INTO the deck card: handed to
  // SlideDeck as DeckChrome.tracking, so it renders inside the card under the
  // badge + title bar (the container with the slide-dot indicator) and stays
  // put for the whole segment while only the slide bodies rotate. A targeted
  // event shows its detail rows; an Areas tour shows the current stop's city +
  // live weather (fetch-free, off the focus bundle's regionCountries). The row
  // rows size the deck (CARD_H + trackingBlockHeight) so slide bodies keep
  // their full height under the readout — the height calc needs the actual
  // label/value pairs now that rows tile two to a line unless one is long.
  let deckTracking: ReactNode = null;
  let deckTrackingRows: { label: string; value: string }[] = [];
  if (onAirSegment && eventTargeted) {
    const extras = nearestCityDetails(onAirSegment, cities);
    deckTrackingRows = [...(onAirSegment.details ?? []), ...extras];
    deckTracking = <EventTrackingLabel segment={onAirSegment} extraDetails={extras} />;
  } else if (onAirSegment?.kind === "region" && focusCaption) {
    const extras = tourStopWeather
      ? [
          {
            label: "Weather",
            value: `${Math.round(tourStopWeather.temp)}° · ${
              CONDITION_LABEL[tourStopWeather.condition] ?? tourStopWeather.condition
            }`,
          },
          ...(tourStopWeather.hi != null && tourStopWeather.lo != null
            ? [
                {
                  label: "Next 24h",
                  value: `hi ${Math.round(tourStopWeather.hi)}° · lo ${Math.round(tourStopWeather.lo)}°`,
                },
              ]
            : []),
        ]
      : [];
    // The place variant leads with its LOCATION row (the tour stop's city).
    // The height rows mirror the rendered value (flag prefix included) so the
    // half-vs-full-width decision matches what actually renders.
    const flag = tourStopWeather ? flagEmoji(tourStopWeather.cc) : undefined;
    deckTrackingRows = [
      { label: "LOCATION", value: flag ? `${flag} ${focusCaption.title}` : focusCaption.title },
      ...extras,
    ];
    deckTracking = (
      <EventTrackingLabel
        segment={{
          ...onAirSegment,
          title: focusCaption.title,
          subtitle: focusCaption.subtitle,
          details: [],
        }}
        extraDetails={extras}
        flag={flag}
        variant="place"
      />
    );
  }

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
      {/* Opt-in diagnostic readout (see `dbg` above) — outside the scaled stage so
          it stays legible; pointer-inert, high z so it sits above the chrome. */}
      {dbg ? (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "rgba(0,0,0,0.82)",
            color: cutting ? "#ff5252" : "#39d353",
            font: "12px ui-monospace, monospace",
            padding: "4px 10px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          id={onAirSegment?.id ?? "—"} · cutting={String(cutting)} · cam=
          {state.camera.center.map((n) => n.toFixed(1)).join(",")}
        </div>
      ) : null}

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
        {/* The locator sub-globe — the stage's FIRST child, so every other
            piece of chrome (the left card deck, the monitor row, the ticker)
            paints OVER it (DOM order, same stacking context): a pure
            bottom-LEFT backdrop rising behind the on-air deck. It follows the
            camera anchor every cut/tour stop patches (state.camera — "the one
            place that actually tracks the live stop") and re-derives a world
            spin from the same deterministic spinSpeed/spinEpoch params
            Globe.tsx uses, so it needs no per-frame camera feed. Ghosted and
            sunk past the stage edge (the stage clips overflow), so the planet
            peeks up from behind the ticker instead of sitting ON the chrome. */}
        {!off.has("subglobe") && (
          <div style={{ position: "absolute", bottom: -72, left: -10, opacity: 0.7 }}>
            <SubGlobeWidget
              size={480}
              center={state.camera.center}
              zoom={state.camera.zoom}
              autoSpin={state.autoSpin}
              spinSpeed={state.spinSpeed}
              spinEpoch={state.spinEpoch}
              accent={onAirSegment ? (KIND_COLOR[onAirSegment.kind] ?? theme.accent) : theme.accent}
              theme={theme}
            />
          </div>
        )}

        {/* Targeted point events (storm/quake/aircraft/ship/volcano) get the
            centred reticle + lower-third, with point-history on its top-right
            and the 3-day forecast strip hung below its bottom edge — both
            travelling with the reticle. The tracking-detail readout no longer
            hangs off the frame: it rides on top of the bottom-left deck
            instead (see EventTrackingLabel below). */}
        {onAirSegment && isTargetedEvent(onAirSegment.kind) ? (
          <EventOverlay
            segment={onAirSegment}
            historyPanel={
              segmentHasLocation ? (
                <PointHistoryPanel
                  center={onAirSegment.camera.center}
                  theme={theme}
                  compact
                  glass
                />
              ) : null
            }
            forecastPanel={
              segmentHasLocation ? (
                <ForecastPanel center={onAirSegment.camera.center} theme={theme} compact glass />
              ) : null
            }
          />
        ) : null}

        {/* Areas (region) tour: the camera frames each country's biggest city dead-
            centre, so a caption-only reticle names the CURRENT CITY there while the
            left card keeps naming the area. The 3-day forecast strip comes from the
            tour stop's country on the focus bundle (regionCountries, matched by
            coordinate) — NOT a per-stop fetch — so the reticle stays fetch-free
            while still showing the stop's outlook. (The stop's current weather rows
            ride the deck-top tracking strip below.) */}
        {onAirSegment?.kind === "region" && focusCaption ? (
          <EventOverlay
            segment={{
              ...onAirSegment,
              title: focusCaption.title,
              subtitle: focusCaption.subtitle,
              details: [],
            }}
            forecastPanel={
              tourStopWeather?.days?.length ? (
                <ForecastPanel center={null} daysOverride={tourStopWeather.days} compact theme={theme} glass />
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
            (self-hiding, variable-height) content. On a targeted event / Areas
            tour the reticle's tracking readout (EventTrackingLabel) rides the
            deck card's own fixed header via DeckChrome.tracking, outside the
            slide rotation, so the event detail rows stay on screen no matter
            which slide is airing. */}
        {!off.has("leftDeck") && (
        <div
          style={{
            position: "absolute",
            left: INSET - 16,
            bottom: TICKER_H + INSET,
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "flex-start",
            gap: 10,
            // Legibility: enlarge the whole deck as a unit (anchored to its
            // bottom-left corner) rather than re-sizing every slide's fonts —
            // keeps the fixed-card layout intact while reading bigger on air.
            transform: "scale(1.2)",
            transformOrigin: "left bottom",
          }}
        >
          {/* The 3-day forecast for a targeted event / region tour stop now hangs
              off the reticle itself (EventOverlay's forecastPanel) rather than
              docking here — so the bottom-left column is just the rotating mode
              deck below. */}

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
                holdMs={state.slideHoldMs}
                resetKey={onAirSegment.id}
                dotColor={KIND_COLOR[onAirSegment.kind] ?? "#38bdf8"}
                chrome={{
                  badge: KIND_BADGE[onAirSegment.kind] ?? onAirSegment.kind,
                  badgeColor: KIND_COLOR[onAirSegment.kind],
                  title: onAirSegment.title,
                  accent: KIND_COLOR[onAirSegment.kind],
                  // The tracking readout rides the card's fixed header (see
                  // deckTracking above); the card grows by its height so the
                  // slide bodies keep their full CARD_H room beneath it.
                  tracking: deckTracking ?? undefined,
                  height: deckTracking ? CARD_H + trackingBlockHeight(deckTrackingRows) : undefined,
                }}
              />
            ) : null}
          </FadeSwap>
        </div>
        )}

        {brandOn && (
          <div
            style={{
              position: "absolute",
              top: BRAND_TOP,
              left: -4,
              transform: `scale(${BRAND_SCALE})`,
              transformOrigin: "left top",
            }}
          >
            <BrandPanel theme={theme} live={directorOn} status={brandStatus} />
          </div>
        )}

        {/* Masthead map widget: the ACTIVE MAP TYPE + its source/timing
            metadata with the colour scale and the world clocks docked beneath,
            all ONE plate (see IntensityMeter part="masthead") hugging the TOP
            of the strip to the right of the logo. The clocks ride the brand
            identity, so turning the intensityMeter widget off blanks only the
            map half and leaves a clocks-only plate. */}
        {brandOn && (
          <div
            style={{
              position: "absolute",
              top: BRAND_TOP + 4,
              left: BRAND_INSET,
              right: 0,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <IntensityMeter
              part="masthead"
              variable={off.has("intensityMeter") ? null : legendVariable}
              units={state.units}
              theme={theme}
              showSatImg={off.has("intensityMeter") ? false : state.showSatImg}
              satImgFeeds={state.satImgFeeds}
              freshness={mapMeta}
              paletteId={legendPalette}
              clocks={<WorldClockStrip theme={theme} framed={false} scale={1.3} />}
            />
          </div>
        )}

        {/* Geomagnetic Kp readout, tucked under the brand block when the aurora
            overlay is on; pushes the intensity meter down so they don't overlap. */}
        {kpShown && !off.has("kpIndex") ? (
          <div
            style={{
              position: "absolute",
              top: BRAND_TOP + BRAND_STACK_H * BRAND_SCALE + 10,
              left: -4,
            }}
          >
            <KpIndexPanel kp={aurora?.meta.kp} theme={theme} />
          </div>
        ) : null}

        {/* Top-centre column: with the brand block on, the whole variable
            legend (hero + scale + clocks) lives up in the masthead plate, so
            only the space-weather colour key (aurora oval / magnetic field)
            renders here; with the brand off the stacked hero+scale legend
            falls back to this slot. Each hides independently when it has
            nothing to show. */}
        <div
          style={{
            position: "absolute",
            top: chromeTop,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          {!brandOn && !off.has("intensityMeter") && (
            <IntensityMeter
              part="all"
              variable={legendVariable}
              units={state.units}
              theme={theme}
              showSatImg={state.showSatImg}
              satImgFeeds={state.satImgFeeds}
              freshness={mapMeta}
              paletteId={legendPalette}
            />
          )}
          {spaceWeatherShown && !off.has("spaceWeather") ? (
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
            // Rides a touch higher than the shared chrome line so the stack
            // clears the sub-globe corner below it.
            top: chromeTop - 20,
            right: INSET - 26,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
            // Legibility: enlarge the whole WORLD WATCH column as a unit
            // (anchored top-right) so the report + feed read bigger on air.
            // (EventOverlay's HISTORY_POS budgets for the scaled left edge.)
            transform: "scale(1.16)",
            transformOrigin: "right top",
          }}
        >
          {!off.has("worldReport") && (
            <WorldReportDeck
              worldWatch={worldWatch}
              manifest={manifest}
              theme={theme}
              reportOff={state.reportOff}
              reportOrder={state.reportOrder}
              reportKindsOff={state.reportKindsOff}
              about={state.about}
            />
          )}
          {/* NEW ALERTS — the just-issued warnings ride below the always-on
              WORLD WATCH summary here, out of the top-centre map legend's way. */}
          {!off.has("liveAlerts") && (
            <LiveAlertPanel alerts={alerts} cities={cities} theme={theme} />
          )}
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
          {!off.has("buildInfo") && <BuildInfoTag />}
          {!off.has("syslog") && <SyslogFeed />}
          {!off.has("upNext") && <UpNextPanel items={upNext} />}
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
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 16,
            // Legibility: enlarge the whole monitor cluster as a unit (same
            // treatment as the left deck's scale(1.2)) — anchored bottom-centre
            // so it grows upward while staying centred over the ticker.
            transform: "translateX(-50%) scale(1.35)",
            transformOrigin: "bottom center",
          }}
        >
          {!off.has("seismic") && (
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
          )}
          {!off.has("weatherMonitors") && (
            <WeatherMonitors
              series={pointHistorySeries}
              locationLabel={
                onAirSegment && segmentHasLocation ? onAirSegment.title : null
              }
              theme={theme}
            />
          )}
          {!off.has("tsunami") && (
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
          )}
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
