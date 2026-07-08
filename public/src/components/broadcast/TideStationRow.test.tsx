import { render, screen } from "@testing-library/react";
import type { TideStationReading } from "../../lib/tides/types";
import TideStationRow from "./TideStationRow";

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

describe("TideStationRow", () => {
  it("renders nothing with fewer than two gauges", () => {
    const { container } = render(<TideStationRow stations={[abashiri]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every nearby gauge side-by-side when two or more are cached", () => {
    render(<TideStationRow stations={[abashiri, other]} />);
    expect(screen.getByText("NEARBY TSUNAMI GAUGES")).toBeInTheDocument();
    expect(screen.getByText("Abashiri")).toBeInTheDocument();
    expect(screen.getByText("Other Bay")).toBeInTheDocument();
    expect(screen.getByText("12 km")).toBeInTheDocument();
    expect(screen.getByText("300 km")).toBeInTheDocument();
  });

  it("skips gauges with no cached samples", () => {
    const empty: TideStationReading = { ...other, samples: [] };
    const { container } = render(<TideStationRow stations={[abashiri, empty]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
