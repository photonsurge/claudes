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
}));
jest.mock("../../lib/world-watch", () => ({ useWorldWatch: () => ({}) }));
jest.mock("../../lib/summaries", () => ({ useLatestRoundup: () => null }));

jest.mock("./Ticker", () => ({ __esModule: true, default: () => null }));
jest.mock("./BrandPanel", () => ({ __esModule: true, default: () => <div data-testid="w-brand" /> }));
jest.mock("./IntensityMeter", () => ({
  __esModule: true,
  default: () => <div data-testid="w-intensityMeter" />,
}));
jest.mock("./LiveAlertPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="w-liveAlerts" />,
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
  WeatherMonitors: () => <div data-testid="w-weatherMonitors" />,
}));
jest.mock("./SeismicStationRow", () => ({ __esModule: true, default: () => null }));
jest.mock("./TideStationRow", () => ({ __esModule: true, default: () => null }));
jest.mock("./PointHistoryPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("./ForecastPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("./EventOverlay", () => ({ __esModule: true, default: () => null }));
jest.mock("./SyslogFeed", () => ({ __esModule: true, default: () => <div data-testid="w-syslog" /> }));
jest.mock("./UpNextPanel", () => ({ __esModule: true, default: () => <div data-testid="w-upNext" /> }));
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
  seismic: "w-seismic",
  weatherMonitors: "w-weatherMonitors",
  tsunami: "w-tsunami",
  leftDeck: "w-leftDeck",
  intensityMeter: "w-intensityMeter",
  spaceWeather: "w-spaceWeather",
  brand: "w-brand",
  kpIndex: "w-kpIndex",
  upNext: "w-upNext",
  syslog: "w-syslog",
  buildInfo: "w-buildInfo",
};

// kpIndex and spaceWeather also require data (aurora/geomag meta) to show at
// all — give both by default so widgetsOff is the only thing under test.
const dataForShownWidgets = {
  state: { ...DEFAULT_CONTROL_STATE, showAurora: true } as ControlState,
  aurora: { meta: { kp: 4 } } as never,
  geomag: { meta: {} } as never,
};

function renderFrame(widgetsOff: WidgetId[]) {
  render(
    <BroadcastFrame
      state={{ ...dataForShownWidgets.state, widgetsOff }}
      manifest={null}
      aurora={dataForShownWidgets.aurora}
      geomag={dataForShownWidgets.geomag}
    />,
  );
}

describe("BroadcastFrame — per-channel widgetsOff gating", () => {
  it("shows every catalog widget when the off-list is empty", () => {
    renderFrame([]);
    for (const id of WIDGET_IDS) {
      expect(screen.getByTestId(TESTID[id])).toBeInTheDocument();
    }
  });

  it("hides exactly the widgets named in widgetsOff, leaves the rest shown", () => {
    renderFrame(["seismic", "syslog"]);
    expect(screen.queryByTestId(TESTID.seismic)).not.toBeInTheDocument();
    expect(screen.queryByTestId(TESTID.syslog)).not.toBeInTheDocument();
    for (const id of WIDGET_IDS) {
      if (id === "seismic" || id === "syslog") continue;
      expect(screen.getByTestId(TESTID[id])).toBeInTheDocument();
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
