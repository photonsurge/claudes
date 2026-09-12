/**
 * BroadcastFrame owns the on-air chrome that ControlState.widgetsOff actually
 * gates (see shared/broadcast-widgets + ChannelSettings). The catalog and the
 * admin toggle form each have their own tests; this one covers the missing
 * link — that BroadcastFrame's `!off.has(id)` checks actually hide/show the
 * right widget for every catalog id, including the two (kpIndex, spaceWeather)
 * that are ALSO gated on data being present.
 *
 * Every child widget is stubbed to a `data-testid`; every focus-client /
 * world-watch / summaries hook (all of which fetch) is stubbed to a static
 * value. `onAirSegment` stays null throughout, which keeps the on-air-only
 * branches (EventOverlay, SlideDeck, mode-slides) out of play — none of that
 * is part of the widgets-off feature under test.
 */
import { render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import { WIDGET_IDS, type WidgetId } from "@photonsurge/shared/broadcast-widgets";
import BroadcastFrame from "./BroadcastFrame";

jest.mock("../../lib/focus/focus-client", () => ({
  useFocusRegion: () => null,
  useFocusCountry: () => null,
  useCountryRoundup: () => null,
  useRegionRoundup: () => null,
  useRegionCountries: () => [],
  useRegionNearTerm: () => [],
  useAreaForecastDays: () => ({ days: [], loading: false }),
  useClimateFor: () => ({ datasets: [], loading: false }),
  useAlertTimeline: () => [],
  useAlertSnapshots: () => [],
  useAlertResources: () => [],
  useAlertSeries: () => [],
  useEventTimeline: () => [],
  useEventSnapshots: () => [],
  useEventResources: () => [],
  useEventSeries: () => [],
  useNearbyCams: () => [],
  useVolcanoMedia: () => [],
  useVolcanoCams: () => [],
  useVolcanoEruptions: () => [],
  useFocusTarget: () => null,
  useLocalZone: () => null,
}));
jest.mock("../../lib/world-watch", () => ({ useWorldWatch: () => ({}) }));
jest.mock("../../lib/summaries", () => ({ useLatestRoundup: () => null }));
// One active sponsor by default so the "ad" crawl-kind gating is observable.
jest.mock("../../lib/ads/use-sponsors", () => ({ useSponsors: () => ["Acme"] }));
jest.mock("../../lib/ads/use-billboard", () => ({ useBillboardAds: () => [] }));
// One placed creative, so the alertSlot gate has something to hide.
jest.mock("../../lib/ads/use-alert-slot", () => ({
  useAlertSlotAds: () => [{ adId: "s1", title: "s1", mediaUrl: "/api/ads/s1/media?v=1" }],
}));
// Stubbed so presence = the frame's widget gate (the real card also self-hides
// on an empty rotation, which would shadow the widgetsOff behaviour under test).
jest.mock("./SponsorBillboard", () => ({
  __esModule: true,
  default: () => <div data-testid="w-billboard" />,
  BILLBOARD_MIN_H: 100,
}));

// The crawl probe exposes what BroadcastFrame actually fed it, so the
// per-channel content gating (tickerKindsOff / tickerHazardsOff) is testable
// without rendering the real marquee.
jest.mock("./Ticker", () => ({
  __esModule: true,
  default: ({ items }: { items: unknown[] }) => (
    <div data-testid="w-ticker" data-items={JSON.stringify(items)} />
  ),
}));
jest.mock("./BrandPanel", () => ({ __esModule: true, default: () => <div data-testid="w-brand" /> }));
jest.mock("./IntensityMeter", () => ({
  __esModule: true,
  default: () => <div data-testid="w-intensityMeter" />,
}));
// The alert-slot sponsor rides inside this panel: the frame gates it by
// handing an empty sponsor list, which the stand-in reports as no testid.
jest.mock("./LiveAlertPanel", () => ({
  __esModule: true,
  default: ({ sponsors = [] }: { sponsors?: unknown[] }) => (
    <div data-testid="w-liveAlerts">{sponsors.length > 0 && <div data-testid="w-alertSlot" />}</div>
  ),
}));
jest.mock("./WorldReportDeck", () => ({
  __esModule: true,
  default: () => <div data-testid="w-worldReport" />,
}));
jest.mock("./KpIndexPanel", () => ({ __esModule: true, default: () => <div data-testid="w-kpIndex" /> }));
jest.mock("./SpaceWeatherMeter", () => ({
  __esModule: true,
  default: () => <div data-testid="w-spaceWeather" />,
}));
jest.mock("./MonitorCluster", () => ({
  SeismicMonitor: () => <div data-testid="w-seismic" />,
  TsunamiMonitor: () => <div data-testid="w-tsunami" />,
  // The frame renders LocalWeatherPanel now (WeatherMonitors is its
  // monitors-only wrapper) and gates the widget via its showMonitors prop
  // (the panel itself stays mounted to carry the forecast strip) — the probe
  // mirrors that gate under the widget id's testid.
  // The seismic + tide monitors moved INSIDE this panel: the frame gates them
  // by passing a station or null, so each probe mirrors that prop rather than
  // looking for a widget of its own.
  LocalWeatherPanel: ({
    showMonitors,
    seismicStation,
    tideStation,
  }: {
    showMonitors?: boolean;
    seismicStation?: unknown;
    tideStation?: unknown;
  }) => (
    <>
      {showMonitors ? <div data-testid="w-weatherMonitors" /> : null}
      {seismicStation ? <div data-testid="w-seismic" /> : null}
      {tideStation ? <div data-testid="w-tsunami" /> : null}
    </>
  ),
}));
jest.mock("./SeismicStationRow", () => ({ __esModule: true, default: () => null }));
jest.mock("./TideStationRow", () => ({ __esModule: true, default: () => null }));
// The frame also imports two PURE helpers from this module (the climate strip's
// row builder + its spark test) — stub them too, or the whole frame throws.
jest.mock("./PointHistoryPanel", () => ({
  __esModule: true,
  default: () => null,
  buildClimateRows: () => [],
  hasSpark: () => false,
}));
jest.mock("./ForecastPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("./EventOverlay", () => ({
  __esModule: true,
  default: () => null,
  EventTrackingLabel: () => null,
  trackingBlockHeight: () => 0,
}));
jest.mock("./SyslogFeed", () => ({ __esModule: true, default: () => <div data-testid="w-syslog" /> }));
jest.mock("./BuildInfoTag", () => ({ __esModule: true, default: () => <div data-testid="w-buildInfo" /> }));
jest.mock("./SlideDeck", () => ({ __esModule: true, default: () => null }));
// FadeSwap wraps the whole "leftDeck" widget — probe its wrapper rather than
// SlideDeck itself, since SlideDeck only renders with a non-null onAirSegment
// and the gating in BroadcastFrame sits one level up, around this whole block.
jest.mock("./FadeSwap", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="w-leftDeck">{children}</div>
  ),
}));

/** One probe testid per catalog widget id — matches the stubs above. */
const TESTID: Record<WidgetId, string> = {
  worldReport: "w-worldReport",
  liveAlerts: "w-liveAlerts",
  alertSlot: "w-alertSlot",
  seismic: "w-seismic",
  weatherMonitors: "w-weatherMonitors",
  tsunami: "w-tsunami",
  leftDeck: "w-leftDeck",
  billboard: "w-billboard",
  intensityMeter: "w-intensityMeter",
  spaceWeather: "w-spaceWeather",
  brand: "w-brand",
  kpIndex: "w-kpIndex",
  syslog: "w-syslog",
  buildInfo: "w-buildInfo",
  ticker: "w-ticker",
};

// kpIndex, spaceWeather, seismic and tsunami also require data (aurora/geomag
// meta, a station carrying samples) to show at all — give all of it by default
// so widgetsOff is the only thing under test.
const dataForShownWidgets = {
  state: { ...DEFAULT_CONTROL_STATE, showAurora: true } as ControlState,
  aurora: { meta: { kp: 4 } } as never,
  geomag: { meta: {} } as never,
  seismoStations: [{ samples: [0, 1] }] as never,
  tideStations: [{ samples: [0, 1] }] as never,
};

function renderFrame(widgetsOff: WidgetId[]) {
  render(
    <BroadcastFrame
      state={{ ...dataForShownWidgets.state, widgetsOff }}
      manifest={null}
      aurora={dataForShownWidgets.aurora}
      geomag={dataForShownWidgets.geomag}
      seismoStations={dataForShownWidgets.seismoStations}
      tideStations={dataForShownWidgets.tideStations}
    />,
  );
}

describe("BroadcastFrame — per-channel widgetsOff gating", () => {
  // intensityMeter renders in one of two slots depending on the brand widget
  // (the masthead plate with the brand on, the top-centre stack with it off)
  // — so "shown" is a count check, not getByTestId.
  it("shows every catalog widget when the off-list is empty", () => {
    renderFrame([]);
    for (const id of WIDGET_IDS) {
      expect(screen.getAllByTestId(TESTID[id]).length).toBeGreaterThan(0);
    }
  });

  it("anchors the left deck below the banner's globe bezel", () => {
    render(
      <BroadcastFrame
        state={{ ...DEFAULT_CONTROL_STATE, widgetsOff: [] }}
        manifest={null}
      />,
    );
    const anchor = screen.getByTestId(TESTID.leftDeck).parentElement;

    expect(anchor).toHaveStyle({ top: "278px", transformOrigin: "left top" });
    expect(anchor?.style.bottom).toBe("");
  });

  it("keeps the left deck below the Kp panel when that panel is visible", () => {
    renderFrame([]);
    const anchor = screen.getByTestId(TESTID.leftDeck).parentElement;

    expect(anchor).toHaveStyle({ top: "346px" });
  });

  it("hides exactly the widgets named in widgetsOff, leaves the rest shown", () => {
    renderFrame(["seismic", "syslog"]);
    expect(screen.queryByTestId(TESTID.seismic)).not.toBeInTheDocument();
    expect(screen.queryByTestId(TESTID.syslog)).not.toBeInTheDocument();
    for (const id of WIDGET_IDS) {
      if (id === "seismic" || id === "syslog") continue;
      expect(screen.getAllByTestId(TESTID[id]).length).toBeGreaterThan(0);
    }
  });

  it("hides every widget when everything is off", () => {
    renderFrame([...WIDGET_IDS]);
    for (const id of WIDGET_IDS) {
      expect(screen.queryByTestId(TESTID[id])).not.toBeInTheDocument();
    }
  });

  it("kpIndex stays hidden while off, even though aurora carries a Kp reading", () => {
    renderFrame(["kpIndex"]);
    expect(screen.queryByTestId(TESTID.kpIndex)).not.toBeInTheDocument();
  });

  it("kpIndex needs the data condition too — off-list alone doesn't force it on", () => {
    render(
      <BroadcastFrame
        state={{ ...DEFAULT_CONTROL_STATE, showAurora: true, widgetsOff: [] }}
        manifest={null}
        aurora={null}
      />,
    );
    expect(screen.queryByTestId(TESTID.kpIndex)).not.toBeInTheDocument();
  });

  it("spaceWeather stays hidden while off, even with an aurora/geomag frame present", () => {
    renderFrame(["spaceWeather"]);
    expect(screen.queryByTestId(TESTID.spaceWeather)).not.toBeInTheDocument();
  });

  it("spaceWeather needs aurora or geomag meta too — off-list alone doesn't force it on", () => {
    render(
      <BroadcastFrame
        state={{ ...DEFAULT_CONTROL_STATE, widgetsOff: [] }}
        manifest={null}
        aurora={null}
        geomag={null}
      />,
    );
    expect(screen.queryByTestId(TESTID.spaceWeather)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Per-channel crawl CONTENT gating (ControlState.tickerKindsOff /
// tickerHazardsOff — see shared/broadcast-ticker). The Ticker stub above
// serialises its `items`, so these assert on what the frame actually fed it.
// ---------------------------------------------------------------------------

const crawlQuake = { id: "q1", mag: 5.9, place: "Somewhere", time: 0, lng: 10, lat: 20, depthKm: 10 } as never;
const crawlVolcano = {
  id: "v1", name: "Etna", country: "Italy", lat: 37.75, lng: 15,
  status: "erupting", firstDate: 0, lastDate: 0, statusChangedAt: 0,
} as never;
const crawlAlert = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: {
    id: "a1", source: "test", identifier: "x", event: "Tsunami Watch",
    severityRank: 3, hazard: "tsunami", areaDesc: "Fiji Region",
  },
} as never;

function crawlItems(state: Partial<ControlState>): string {
  render(
    <BroadcastFrame
      state={{ ...DEFAULT_CONTROL_STATE, ...state } as ControlState}
      manifest={null}
      quakes={[crawlQuake]}
      volcanoes={[crawlVolcano]}
      alerts={[crawlAlert]}
    />,
  );
  return screen.getByTestId("w-ticker").getAttribute("data-items") ?? "";
}

describe("BroadcastFrame — per-channel crawl content (tickerKindsOff)", () => {
  it("feeds every kind (plus the sponsor mention) with an empty off-list", () => {
    const items = crawlItems({});
    expect(items).toContain("SEISMIC");
    expect(items).toContain("VOLCANO ERUPTING");
    expect(items).toContain("Tsunami");
    expect(items).toContain("Sponsored by Acme");
  });

  it("drops exactly the kinds on the off-list", () => {
    const items = crawlItems({ tickerKindsOff: ["quake", "volcano"] });
    expect(items).not.toContain("SEISMIC");
    expect(items).not.toContain("VOLCANO");
    expect(items).toContain("Tsunami");
    expect(items).toContain("Sponsored by Acme");
  });

  it("'ad' off strips the sponsor weave, leaving the live feed intact", () => {
    const items = crawlItems({ tickerKindsOff: ["ad"] });
    expect(items).not.toContain("Sponsored by");
    expect(items).toContain("SEISMIC");
  });

  it("tickerHazardsOff filters the crawl's alerts by hazard", () => {
    const items = crawlItems({ tickerHazardsOff: ["tsunami"] });
    expect(items).not.toContain("Tsunami Watch");
    expect(items).toContain("SEISMIC");
  });
});
