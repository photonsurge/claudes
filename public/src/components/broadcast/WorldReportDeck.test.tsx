import { render, screen } from "@testing-library/react";
import { DECK_SLIDES } from "./WorldReportDeck";
import HazardScreen from "./HazardScreen";
import AboutPanel from "./AboutPanel";
import { filterFeedByKind } from "../../lib/broadcast";
import type { WorldWatchItem } from "../../lib/broadcast";
import { DEFAULT_THEME } from "./config";

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

describe("DECK_SLIDES", () => {
  it("rotates DETECTION GRID first, then the world report, categories, and about", () => {
    expect([...DECK_SLIDES]).toEqual(["detection", "hourly", "alerts", "seismic", "volcanoes", "about"]);
  });
});

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
    render(<AboutPanel theme={DEFAULT_THEME} />);
    expect(screen.getByText("About G.O.D.S.")).toBeInTheDocument();
    expect(screen.getByText(/live visual monitoring platform created by Thronix/)).toBeInTheDocument();
    expect(screen.getByText(/not an official warning service/)).toBeInTheDocument();
  });
});
