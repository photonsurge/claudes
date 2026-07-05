import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import type { SeismoStationReading } from "../../lib/seismo/types";
import SeismicStationRow from "./SeismicStationRow";

const quakeSeg: Segment = {
  id: "quake:x",
  kind: "quake",
  title: "M6.2 — Off Kermadec",
  camera: { center: [178, -30], zoom: 4 },
  patch: {},
  holdMs: 1000,
};

const stormSeg: Segment = {
  id: "storm:x",
  kind: "storm",
  title: "Severe Storm",
  camera: { center: [0, 0], zoom: 3 },
  patch: {},
  holdMs: 1000,
};

const stationA: SeismoStationReading = {
  net: "IU",
  sta: "ANMO",
  loc: "00",
  cha: "BHZ",
  siteName: "Albuquerque, New Mexico, USA",
  lat: 35,
  lng: -106,
  distanceKm: 40,
  sampleRateHz: 40,
  samples: [{ t: 1, v: 100 }, { t: 2, v: 105 }],
  latest: 105,
  updatedAt: 0,
};
const stationB: SeismoStationReading = { ...stationA, sta: "OTHER", siteName: "Somewhere", distanceKm: 300 };

describe("SeismicStationRow", () => {
  it("renders nothing on a non-quake segment", () => {
    const { container } = render(<SeismicStationRow stations={[stationA, stationB]} onAirSegment={stormSeg} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a quake segment with fewer than two stations", () => {
    const { container } = render(<SeismicStationRow stations={[stationA]} onAirSegment={quakeSeg} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every nearby station side-by-side on a focused quake event", () => {
    render(<SeismicStationRow stations={[stationA, stationB]} onAirSegment={quakeSeg} />);
    expect(screen.getByText("NEARBY SEISMOGRAPH STATIONS")).toBeInTheDocument();
    expect(screen.getByText("Albuquerque")).toBeInTheDocument();
    expect(screen.getByText("Somewhere")).toBeInTheDocument();
    expect(screen.getByText("40 km")).toBeInTheDocument();
    expect(screen.getByText("300 km")).toBeInTheDocument();
  });

  it("skips stations with no cached samples", () => {
    const empty: SeismoStationReading = { ...stationB, samples: [] };
    const { container } = render(<SeismicStationRow stations={[stationA, empty]} onAirSegment={quakeSeg} />);
    // Only one station has real data, so it still falls below the "> 1" bar.
    expect(container).toBeEmptyDOMElement();
  });
});
