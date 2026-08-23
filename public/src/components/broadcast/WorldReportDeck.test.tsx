import { render, screen } from "@testing-library/react";
import HazardScreen from "./HazardScreen";
import AboutPanel from "./AboutPanel";
import WorldReportDeck from "./WorldReportDeck";
import { filterFeedByKind } from "../../lib/broadcast";
import type { WorldWatchItem } from "../../lib/broadcast";
import type { WorldWatchState } from "../../lib/world-watch";
import { DEFAULT_THEME } from "./config";

// The WORLD REPORT slide pulls a global area forecast; stub it so the deck can
// mount without a fetch (only the "hourly" slide reads it anyway).
jest.mock("../../lib/forecast-client", () => ({ useAreaForecast: () => ({ days: [], loading: false }) }));

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
        continents={[{ name: "Asia", count: 20, segments: [{ key: "s", color: "#f00", count: 20 }] }]}
        feed={[feedItem("quake", "q1")]}
        theme={DEFAULT_THEME}
      />,
    );
    expect(screen.getByText("SEISMIC ACTIVITY")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Asia")).toBeInTheDocument();
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
    render(<AboutPanel theme={DEFAULT_THEME} feed={[]} />);
    expect(screen.getByText("About G.O.D.S.")).toBeInTheDocument();
    expect(screen.getByText(/live visual monitoring platform created by Thronix/)).toBeInTheDocument();
    expect(screen.getByText(/not an official warning service/)).toBeInTheDocument();
  });

  it("carries the integrated ACTIVE FEED at its foot", () => {
    render(<AboutPanel theme={DEFAULT_THEME} feed={[]} />);
    expect(screen.getByText("ACTIVE FEED")).toBeInTheDocument();
  });

  it("renders per-channel custom copy — title, paragraphs, sources and footnote", () => {
    render(
      <AboutPanel
        theme={DEFAULT_THEME}
        feed={[]}
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
        feed={[]}
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
        manifest={null}
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
        manifest={null}
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
        manifest={null}
        reportOff={["detection", "hourly", "alerts", "seismic", "volcanoes"]}
        about={{ title: "About Storm Watch", body: "", sources: "NOAA GFS", footer: "" }}
      />,
    );
    expect(screen.getByText("About Storm Watch")).toBeInTheDocument();
    expect(screen.getByText("NOAA GFS")).toBeInTheDocument();
  });

  it("renders nothing when every report slide is hidden", () => {
    const { container } = render(
      <WorldReportDeck
        worldWatch={emptyWatch}
        manifest={null}
        reportOff={["detection", "hourly", "alerts", "seismic", "volcanoes", "about"]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
