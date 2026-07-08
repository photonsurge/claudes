import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import type { Quake } from "../../lib/tracks/types";
import type { SeismoStationReading } from "../../lib/seismo/types";
import type { TideStationReading } from "../../lib/tides/types";
import type { HistorySeries } from "../../lib/history-client";
import { SeismicMonitor, TsunamiMonitor, WeatherMonitors } from "./MonitorCluster";

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

describe("SeismicMonitor relevance", () => {
  it("shows the global seismograph with its magnitude on a wide shot", () => {
    render(<SeismicMonitor quakes={[quakeFarFromOrigin]} />);
    expect(screen.getByText("SEISMIC MONITOR")).toBeInTheDocument();
    expect(screen.getByText("M6.2")).toBeInTheDocument();
  });

  it("hides (renders null) on a focused land shot with nothing relevant", () => {
    const { container } = render(<SeismicMonitor quakes={[quakeFarFromOrigin]} onAirSegment={stormAtOrigin} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active real seismograph station's name + a position-in-set caption when in range", () => {
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
      <SeismicMonitor
        quakes={[quakeFarFromOrigin]}
        seismoStations={[stationA, stationB]}
        seismoActive={stationA}
      />,
    );
    expect(screen.getByText("SEISMIC MONITOR")).toBeInTheDocument();
    expect(screen.getByText("Albuquerque · 1/2")).toBeInTheDocument();
  });
});

describe("TsunamiMonitor relevance", () => {
  it("hides (renders null) when nothing's cached near the shot", () => {
    const { container } = render(<TsunamiMonitor stations={[]} active={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the tsunami gauge with the real station + level when a coastal gauge is in range", () => {
    render(<TsunamiMonitor stations={[abashiri]} active={abashiri} />);
    expect(screen.getByText("TSUNAMI GAUGE")).toBeInTheDocument();
    expect(screen.getByText("Abashiri")).toBeInTheDocument();
    expect(screen.getByText(/1\.27 m/)).toBeInTheDocument();
  });

  it("hides (renders null) when 2+ gauges are in range, deferring to TideStationRow", () => {
    const other: TideStationReading = { ...abashiri, stationId: "other", name: "Somewhere Else" };
    const { container } = render(<TsunamiMonitor stations={[abashiri, other]} active={abashiri} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WeatherMonitors", () => {
  it("renders nothing when the archive has no series for the focus", () => {
    const { container } = render(<WeatherMonitors series={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a card per variable with 2+ archived samples, with its latest reading + units", () => {
    const series: HistorySeries[] = [
      {
        variable: "wind",
        encoding: "uv",
        units: "m/s",
        lat: 0,
        lng: 0,
        series: [{ t: "1", model: "gfs", fhr: 0, speed: 4 }, { t: "2", model: "gfs", fhr: 1, speed: 6 }],
        stats: null,
      },
      {
        variable: "pressure",
        encoding: "scalar",
        units: "hPa",
        lat: 0,
        lng: 0,
        // Single sample isn't enough to draw a trace.
        series: [{ t: "1", model: "gfs", fhr: 0, value: 1008 }],
        stats: null,
      },
    ];
    render(<WeatherMonitors series={series} locationLabel="Chiayi City" />);
    expect(screen.getByText("Chiayi City")).toBeInTheDocument();
    expect(screen.getByText("LOCAL MONITORS")).toBeInTheDocument();
    expect(screen.getByText("WIND MONITOR")).toBeInTheDocument();
    expect(screen.getByText("6 m/s")).toBeInTheDocument();
    expect(screen.queryByText("PRESSURE MONITOR")).not.toBeInTheDocument();
    expect(screen.queryByText("WAVE MONITOR")).not.toBeInTheDocument();
  });
});
