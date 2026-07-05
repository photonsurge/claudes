import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import type { TideStationReading } from "../../lib/tides/types";
import { useTideGauge } from "../../lib/tide-gauge";
import TideStationRow from "./TideStationRow";

jest.mock("../../lib/tide-gauge", () => ({ useTideGauge: jest.fn() }));
const mockGauge = useTideGauge as jest.Mock;

const stormSeg: Segment = {
  id: "storm:x",
  kind: "storm",
  title: "Severe Storm",
  camera: { center: [0, 0], zoom: 3 },
  patch: {},
  holdMs: 1000,
};

const abashiri: TideStationReading = {
  stationId: "abas",
  provider: "ioc",
  name: "Abashiri",
  lat: 44,
  lng: 144,
  distanceKm: 12,
  unit: "m",
  samples: [{ t: 1, v: 1.2 }, { t: 2, v: 1.45 }],
  latest: 1.27,
  updatedAt: 0,
};
const other: TideStationReading = { ...abashiri, stationId: "other", name: "Other Bay", distanceKm: 300 };

beforeEach(() => mockGauge.mockReset());

describe("TideStationRow", () => {
  it("renders nothing with fewer than two gauges", () => {
    mockGauge.mockReturnValue({ stations: [abashiri], active: abashiri });
    const { container } = render(<TideStationRow onAirSegment={stormSeg} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every nearby gauge side-by-side when two or more are cached", () => {
    mockGauge.mockReturnValue({ stations: [abashiri, other], active: abashiri });
    render(<TideStationRow onAirSegment={stormSeg} />);
    expect(screen.getByText("NEARBY TSUNAMI GAUGES")).toBeInTheDocument();
    expect(screen.getByText("Abashiri")).toBeInTheDocument();
    expect(screen.getByText("Other Bay")).toBeInTheDocument();
    expect(screen.getByText("12 km")).toBeInTheDocument();
    expect(screen.getByText("300 km")).toBeInTheDocument();
  });

  it("skips gauges with no cached samples", () => {
    const empty: TideStationReading = { ...other, samples: [] };
    mockGauge.mockReturnValue({ stations: [abashiri, empty], active: abashiri });
    const { container } = render(<TideStationRow onAirSegment={stormSeg} />);
    expect(container).toBeEmptyDOMElement();
  });
});
