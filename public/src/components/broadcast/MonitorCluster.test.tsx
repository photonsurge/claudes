import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import type { Quake } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import type { TideStationReading } from "../../lib/tides/types";
import { useTideGauge } from "../../lib/tide-gauge";
import MonitorCluster from "./MonitorCluster";

jest.mock("../../lib/tide-gauge", () => ({ useTideGauge: jest.fn() }));
const mockGauge = useTideGauge as jest.Mock;

const quakeFarFromOrigin: Quake = { id: "q1", mag: 6.2, place: "Off Kermadec", time: 0, lng: 178, lat: -30, depthKm: 10 };

const stormAtOrigin: Segment = {
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

beforeEach(() => mockGauge.mockReset());

describe("MonitorCluster relevance", () => {
  it("shows the global seismograph with its magnitude on a wide shot", () => {
    mockGauge.mockReturnValue({ stations: [], active: null });
    render(<MonitorCluster quakes={[quakeFarFromOrigin]} />);
    expect(screen.getByText("SEISMIC MONITOR")).toBeInTheDocument();
    expect(screen.getByText("M6.2")).toBeInTheDocument();
    expect(screen.queryByText("TSUNAMI GAUGE")).not.toBeInTheDocument();
  });

  it("hides everything (renders null) on a focused land shot with nothing relevant", () => {
    mockGauge.mockReturnValue({ stations: [], active: null });
    const { container } = render(<MonitorCluster quakes={[quakeFarFromOrigin]} onAirSegment={stormAtOrigin} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the tsunami gauge with the real station + level when a coastal gauge is in range", () => {
    mockGauge.mockReturnValue({ stations: [abashiri], active: abashiri });
    render(<MonitorCluster quakes={[quakeFarFromOrigin]} onAirSegment={stormAtOrigin} />);
    expect(screen.getByText("TSUNAMI GAUGE")).toBeInTheDocument();
    expect(screen.getByText("Abashiri")).toBeInTheDocument();
    expect(screen.getByText(/1\.27 m/)).toBeInTheDocument();
    // Seismic hidden — the storm shot is far from any quake.
    expect(screen.queryByText("SEISMIC MONITOR")).not.toBeInTheDocument();
  });

  it("shows the active tide station's name + a position-in-set caption when multiple gauges are in range", () => {
    const other: TideStationReading = { ...abashiri, stationId: "other", name: "Somewhere Else" };
    mockGauge.mockReturnValue({ stations: [abashiri, other], active: abashiri });
    render(<MonitorCluster quakes={[quakeFarFromOrigin]} onAirSegment={stormAtOrigin} />);
    expect(screen.getByText("Abashiri · 1/2")).toBeInTheDocument();
  });

  it("shows the active real seismograph station's name + a position-in-set caption when in range", () => {
    mockGauge.mockReturnValue({ stations: [], active: null });
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
    const stationB: SeismoStationReading = { ...stationA, sta: "OTHER", siteName: "Somewhere Else" };
    render(
      <MonitorCluster
        quakes={[quakeFarFromOrigin]}
        seismoStations={[stationA, stationB]}
        seismoActive={stationA}
      />,
    );
    expect(screen.getByText("SEISMIC MONITOR")).toBeInTheDocument();
    expect(screen.getByText("Albuquerque · 1/2")).toBeInTheDocument();
  });
});
