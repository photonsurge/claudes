import { act, render, screen } from "@testing-library/react";
import HazardScreen from "./HazardScreen";
import AboutPanel from "./AboutPanel";
import WorldReportDeck from "./WorldReportDeck";
import { filterFeedByKind } from "../../lib/broadcast";
import type { WorldWatchItem } from "../../lib/broadcast";
import type { WorldWatchState } from "../../lib/world-watch";
import { DEFAULT_THEME } from "./config";

const mockReportCities = jest.fn(() => [] as { label: string; lat: number; lng: number }[]);
jest.mock("../../lib/focus/focus-client", () => ({ useReportCities: () => mockReportCities() }));

const mockUsePointForecast = jest.fn((_center: [number, number] | null) => ({ days: [] as import("../../lib/forecast-client").ForecastDay[], loading: false }));
jest.mock("../../lib/forecast-client", () => ({
  usePointForecast: (center: [number, number] | null) => mockUsePointForecast(center),
}));

function feedItem(kind: WorldWatchItem["kind"], key: string): WorldWatchItem {
  return {
    key,
    kind,
    color: "#f00",
    tag: "TAG",
    icon: "▲",
    flag: "",
    title: `${kind} ${key}`,
    sub: "somewhere",
    weight: 1,
    sortTime: 0,
  };
}

describe("filterFeedByKind", () => {
  const feed = [feedItem("alert", "a"), feedItem("quake", "q"), feedItem("volcano", "v"), feedItem("alert", "a2")];

  it("keeps only rows of the requested kind, in order", () => {
    expect(filterFeedByKind(feed, "alert").map((i) => i.key)).toEqual(["a", "a2"]);
    expect(filterFeedByKind(feed, "quake").map((i) => i.key)).toEqual(["q"]);
    expect(filterFeedByKind(feed, "volcano").map((i) => i.key)).toEqual(["v"]);
  });

  it("returns an empty list when no rows match", () => {
    expect(filterFeedByKind([], "alert")).toEqual([]);
  });
});

describe("HazardScreen", () => {
  it("renders the title, hero count, breakdown chips and the filtered feed", () => {
    render(
      <HazardScreen
        title="SEISMIC ACTIVITY"
        heroLabel="QUAKES"
        heroCount={42}
        heroColor="#4dc8ff"
        subtitle="Strongest M6.3 · off the coast"
        chips={[{ key: "major", label: "Major", count: 3, color: "#f00" }]}
        continents={[{ name: "North America", count: 20, segments: [{ key: "s", color: "#f00", count: 20 }] }]}
        feed={[feedItem("quake", "q1")]}
        theme={DEFAULT_THEME}
      />,
    );
    expect(screen.getByText("SEISMIC ACTIVITY")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("North America")).toHaveStyle({ flex: "0 0 112px" });
    expect(screen.getByText(/Strongest M6.3/)).toBeInTheDocument();
    expect(screen.getByText("quake q1")).toBeInTheDocument();
  });

  it("shows the empty-feed label when the category has no rows", () => {
    render(
      <HazardScreen
        title="VOLCANIC ACTIVITY"
        heroLabel="ACTIVE VOLCANOES"
        heroCount={0}
        heroColor="#f97316"
        chips={[]}
        continents={[]}
        feed={[]}
        emptyFeedLabel="NO ACTIVE VOLCANOES"
        theme={DEFAULT_THEME}
      />,
    );
    expect(screen.getByText("NO ACTIVE VOLCANOES")).toBeInTheDocument();
  });
});

describe("AboutPanel", () => {
  it("renders the G.O.D.S. about copy and warning-service disclaimer", () => {
    render(<AboutPanel theme={DEFAULT_THEME} />);
    expect(screen.getByText("About G.O.D.S.")).toBeInTheDocument();
    expect(screen.getByText(/live visual monitoring platform created by Thronix/)).toBeInTheDocument();
    expect(screen.getByText(/not an official warning service/)).toBeInTheDocument();
  });

  it("does not show the active feed on the about slide", () => {
    render(<AboutPanel theme={DEFAULT_THEME} />);
    expect(screen.queryByText("ACTIVE FEED")).not.toBeInTheDocument();
  });

  it("renders per-channel custom copy — title, paragraphs, sources and footnote", () => {
    render(
      <AboutPanel
        theme={DEFAULT_THEME}
        about={{
          title: "About Storm Watch",
          body: "First paragraph.\n\nSecond paragraph.",
          sources: "NOAA GFS\nUSGS, GDACS",
          footer: "Custom small print.",
        }}
      />,
    );
    expect(screen.getByText("About Storm Watch")).toBeInTheDocument();
    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
    // Sources accept newlines OR commas and render as one dotted credit line.
    expect(screen.getByText("DATA SOURCES")).toBeInTheDocument();
    expect(screen.getByText("NOAA GFS · USGS · GDACS")).toBeInTheDocument();
    expect(screen.getByText("Custom small print.")).toBeInTheDocument();
    // The built-in copy is fully replaced.
    expect(screen.queryByText(/live visual monitoring platform/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not an official warning service/)).not.toBeInTheDocument();
  });

  it("falls back per-field: sources alone keep the built-in copy + disclaimer", () => {
    render(
      <AboutPanel
        theme={DEFAULT_THEME}
        about={{ title: "", body: "", sources: "NOAA GFS", footer: "" }}
      />,
    );
    expect(screen.getByText("About G.O.D.S.")).toBeInTheDocument();
    expect(screen.getByText(/live visual monitoring platform created by Thronix/)).toBeInTheDocument();
    expect(screen.getByText("NOAA GFS")).toBeInTheDocument();
    expect(screen.getByText(/not an official warning service/)).toBeInTheDocument();
  });
});

describe("WorldReportDeck per-channel curation", () => {
  const emptyWatch = {
    bySeverity: [],
    byContinent: [],
    byMagClass: [],
    byVolcanoStatus: [],
    feed: [],
    alertTotal: 0,
    quakeCount: 0,
    volcanoCount: 0,
    maxQuake: null,
  } as unknown as WorldWatchState;

  it("a seismic-focused channel opens on the SEISMIC slide, not the weather ones", () => {
    // Everything hidden except seismic → the deck has one slide and opens on it.
    render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        reportOff={["detection", "hourly", "alerts", "volcanoes", "about"]}
      />,
    );
    expect(screen.getByText("SEISMIC ACTIVITY")).toBeInTheDocument();
    expect(screen.queryByText("GLOBAL ALERTS")).not.toBeInTheDocument();
  });

  it("threads reportKindsOff to the DETECTION GRID so a hidden kind's column disappears", () => {
    render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        reportOff={["hourly", "alerts", "seismic", "volcanoes", "about"]}
        reportKindsOff={["alert"]}
      />,
    );
    expect(screen.getByText("DETECTION GRID")).toBeInTheDocument();
    expect(screen.queryByText("ALERTS")).not.toBeInTheDocument();
    expect(screen.getByText("SEISMIC")).toBeInTheDocument();
  });

  it("threads the channel's about copy to the ABOUT slide", () => {
    render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        reportOff={["detection", "hourly", "alerts", "seismic", "volcanoes"]}
        about={{ title: "About Storm Watch", body: "", sources: "NOAA GFS", footer: "" }}
      />,
    );
    expect(screen.getByText("About Storm Watch")).toBeInTheDocument();
    expect(screen.getByText("NOAA GFS")).toBeInTheDocument();
  });

  it("rotates on the channel's holdMs dwell", () => {
    jest.useFakeTimers();
    try {
      render(
        <WorldReportDeck
          worldWatch={emptyWatch}
          reportOff={["detection", "hourly", "alerts", "about"]}
          holdMs={5000}
        />,
      );
      expect(screen.getByText("SEISMIC ACTIVITY")).toBeInTheDocument();

      // One dwell short of the hold → still on the first slide.
      act(() => void jest.advanceTimersByTime(4999));
      expect(screen.getByText("SEISMIC ACTIVITY")).toBeInTheDocument();

      // Crossing the hold advances to the next curated slide.
      act(() => void jest.advanceTimersByTime(1));
      expect(screen.getByText("VOLCANIC ACTIVITY")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps a shown page mounted after the flip, skipped by layout while off screen", () => {
    jest.useFakeTimers();
    try {
      render(
        <WorldReportDeck
          worldWatch={emptyWatch}
          reportOff={["detection", "hourly", "alerts", "about"]}
          holdMs={5000}
        />,
      );
      const wrapper = (text: string) => screen.getByText(text).closest("[aria-hidden]") as HTMLElement;
      expect(wrapper("SEISMIC ACTIVITY").getAttribute("aria-hidden")).toBe("false");
      // Up next: mounted (its data can land early) but not laid out.
      expect(wrapper("VOLCANIC ACTIVITY").getAttribute("aria-hidden")).toBe("true");
      expect(wrapper("VOLCANIC ACTIVITY").style.contentVisibility).toBe("hidden");

      act(() => void jest.advanceTimersByTime(5000));
      expect(wrapper("VOLCANIC ACTIVITY").getAttribute("aria-hidden")).toBe("false");
      expect(wrapper("VOLCANIC ACTIVITY").style.contentVisibility).not.toBe("hidden");
      // The page that just left stays in the DOM, parked off screen.
      expect(wrapper("SEISMIC ACTIVITY").getAttribute("aria-hidden")).toBe("true");
      expect(wrapper("SEISMIC ACTIVITY").style.contentVisibility).toBe("hidden");
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders nothing when every report slide is hidden", () => {
    const { container } = render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        reportOff={["detection", "hourly", "alerts", "seismic", "volcanoes", "about"]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders point forecasts for the scene's chosen weather locations", () => {
    render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        reportOff={["detection", "alerts", "seismic", "volcanoes", "about"]}
        weatherLocations={[
          { label: "London", lat: 51.507, lng: -0.128 },
          { label: "Tokyo", lat: 35.676, lng: 139.65 },
        ]}
      />,
    );

    expect(screen.getByText("LOCATION WEATHER")).toBeInTheDocument();
    expect(screen.getByText("LONDON")).toBeInTheDocument();
    expect(screen.getByText("TOKYO")).toBeInTheDocument();
    expect(screen.queryByText("ACTIVE FEED")).not.toBeInTheDocument();
    expect(mockUsePointForecast).toHaveBeenCalledWith([-0.128, 51.507]);
    expect(mockUsePointForecast).toHaveBeenCalledWith([139.65, 35.676]);
  });
  it("uses cities from the current area instead of configured locations or the camera centre", () => {
    mockReportCities.mockReturnValue([{ label: "London", lat: 51.5, lng: -0.1 }]);
    const { rerender } = render(<WorldReportDeck worldWatch={emptyWatch}
      reportOrder={["hourly"]} areaKind="country" areaName="United Kingdom"
      weatherLocations={[{ label: "Tokyo", lat: 35, lng: 139 }]} />);
    expect(screen.getByText("CITY WEATHER")).toBeInTheDocument();
    expect(screen.getByText("LONDON")).toBeInTheDocument();
    expect(screen.queryByText("TOKYO")).not.toBeInTheDocument();
    mockReportCities.mockReturnValue([]);
    rerender(<WorldReportDeck worldWatch={emptyWatch} reportOrder={["hourly"]}
      areaKind="region" areaName="Europe" />);
    expect(screen.queryByText("LONDON")).not.toBeInTheDocument();
    expect(screen.getByText("City forecasts unavailable")).toBeInTheDocument();
  });

  it("shows detailed forecasts at the selected target", () => {
    mockUsePointForecast.mockReturnValue({ loading: false, days: [{
      date: "2026-09-09", label: "TODAY", hiTemp: 22, loTemp: 14,
      windAvg: 5, gustMax: 12, cloudAvg: 80, precipChance: 60, condition: "rain", hazards: [],
    } as import("../../lib/forecast-client").ForecastDay] });
    render(<WorldReportDeck worldWatch={emptyWatch} reportOrder={["hourly"]}
      targetLocation={{ label: "Selected storm", lat: 51.5, lng: -0.1 }} />);
    expect(screen.getByText("TARGET WEATHER")).toBeInTheDocument();
    expect(screen.getByText("SELECTED STORM")).toBeInTheDocument();
    expect(screen.getByText("Wind 5 m/s")).toBeInTheDocument();
    expect(screen.getByText("Gusts 12 m/s")).toBeInTheDocument();
    expect(screen.getByText("Chance of rain 60%")).toBeInTheDocument();
    expect(mockUsePointForecast).toHaveBeenCalledWith([-0.1, 51.5]);
  });

});
