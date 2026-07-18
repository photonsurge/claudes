import { render, screen } from "@testing-library/react";
import OnAirCard from "./OnAirCard";
import { DeckChromeContext } from "./BroadcastCard";
import type { Segment } from "@photonsurge/shared/director";
import type { Quake } from "../../lib/tracks/types";
import type { AreaInfo } from "./mode-slides";
import type { WorldSummary } from "../../lib/broadcast";

const seg = (over: Record<string, unknown> = {}): Segment =>
  ({ kind: "quake", id: "quake:x", title: "M6.1 — Off Coast", camera: { center: [0, 0], zoom: 6 }, ...over }) as unknown as Segment;

const quake = (over: Partial<Quake> = {}): Quake => ({ id: "us1", mag: 4.2, time: 0, lng: 0, lat: 0, depthKm: 10, ...over });

const sevRow = (rank: number, color: string, count: number) => ({ rank, label: `S${rank}`, color, count });
const world = (over: Partial<WorldSummary> = {}): WorldSummary =>
  ({
    alertTotal: 545,
    bySeverity: [sevRow(4, "#ef4444", 29), sevRow(3, "#f97316", 131)],
    quakeCount: 0,
    byMagClass: [],
    maxMag: 0,
    maxQuake: null,
    volcanoCount: 0,
    byVolcanoStatus: [],
    byContinent: [
      { continent: "Asia", alertCount: 182, quakeCount: 0, volcanoCount: 0, total: 182, bySeverity: [sevRow(3, "#f97316", 182)], byMagClass: [], byVolcanoStatus: [] },
      { continent: "Europe", alertCount: 88, quakeCount: 0, volcanoCount: 0, total: 88, bySeverity: [sevRow(2, "#eab308", 88)], byMagClass: [], byVolcanoStatus: [] },
      { continent: "Antarctica", alertCount: 0, quakeCount: 3, volcanoCount: 0, total: 3, bySeverity: [], byMagClass: [], byVolcanoStatus: [] },
    ],
    ...over,
  }) as WorldSummary;

describe("OnAirCard", () => {
  it("inside the deck wears the template header (event type + title) and no ON AIR", () => {
    render(
      <DeckChromeContext.Provider value={{ badge: "Seismic", title: "M6.1 — Off Coast", accent: "#e08a1e" }}>
        <OnAirCard segment={seg()} />
      </DeckChromeContext.Provider>,
    );
    expect(screen.getByText("Seismic")).toBeInTheDocument();
    expect(screen.getByText("M6.1 — Off Coast")).toBeInTheDocument();
    expect(screen.queryByText("ON AIR")).not.toBeInTheDocument();
  });

  it("renders the area block (name + blurb) when areaInfo is supplied", () => {
    const area: AreaInfo = { name: "Japan", photo: null, blurb: "An island nation in East Asia." };
    render(<OnAirCard segment={seg()} areaInfo={area} />);
    expect(screen.getByText("The Area")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByText("An island nation in East Asia.")).toBeInTheDocument();
  });

  it("omits the area block when areaInfo has neither photo nor blurb", () => {
    render(<OnAirCard segment={seg()} areaInfo={{ name: "Nowhere", photo: null, blurb: null }} />);
    expect(screen.queryByText("The Area")).not.toBeInTheDocument();
  });

  describe("hazard rollup wording", () => {
    it("labels a tracked event's rollup NEARBY, leading with what's present", () => {
      // A quake segment with another seismic in range — subject exclusion happens
      // upstream, so this asserts the label + "lead with present" only.
      render(<OnAirCard segment={seg({ kind: "quake", id: "quake:x" })} quakes={[quake()]} />);
      expect(screen.getByText("NEARBY")).toBeInTheDocument();
      expect(screen.queryByText("IN VIEW")).not.toBeInTheDocument();
      expect(screen.getByText("seismic")).toBeInTheDocument();
    });

    it("says NOTHING ELSE NEARBY on an event shot with nothing else in range", () => {
      render(<OnAirCard segment={seg({ kind: "volcano", id: "volcano:x" })} />);
      expect(screen.getByText("NOTHING ELSE NEARBY")).toBeInTheDocument();
    });

    it("labels a framed area's rollup IN VIEW", () => {
      render(<OnAirCard segment={seg({ kind: "country", id: "country:japan" })} quakes={[quake()]} />);
      expect(screen.getByText("IN VIEW")).toBeInTheDocument();
      expect(screen.queryByText("NEARBY")).not.toBeInTheDocument();
    });
  });

  describe("whole-globe spin (world prop)", () => {
    it("labels the rollup WORLDWIDE with the global total and a per-continent breakdown", () => {
      render(<OnAirCard segment={seg({ kind: "ocean", id: "ocean:x" })} world={world()} />);
      expect(screen.getByText("WORLDWIDE")).toBeInTheDocument();
      expect(screen.queryByText("IN VIEW")).not.toBeInTheDocument();
      expect(screen.getByText("545")).toBeInTheDocument();
      // Continents with alerts show, busiest first; the hazard-type breakdown is
      // replaced by the by-area rows.
      expect(screen.getByText("Asia")).toBeInTheDocument();
      expect(screen.getByText("182")).toBeInTheDocument();
      expect(screen.getByText("Europe")).toBeInTheDocument();
      expect(screen.getByText("88")).toBeInTheDocument();
    });

    it("drops continents with no active alerts from the breakdown", () => {
      render(<OnAirCard segment={seg({ kind: "ocean", id: "ocean:x" })} world={world()} />);
      // Antarctica had only quakes (alertCount 0) — not an alert-area row.
      expect(screen.queryByText("Antarctica")).not.toBeInTheDocument();
    });
  });
});
