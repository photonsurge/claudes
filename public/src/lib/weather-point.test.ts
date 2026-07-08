import type { Segment } from "@photonsurge/shared/director";
import type { HistorySeries } from "./history-client";
import { selectWeatherPoint } from "./weather-point";

const windSeries: HistorySeries[] = [
  {
    variable: "wind",
    encoding: "uv",
    units: "m/s",
    lat: 0,
    lng: 0,
    series: [{ t: "1", model: "gfs", fhr: 0, speed: 4 }, { t: "2", model: "gfs", fhr: 1, speed: 6 }],
    stats: null,
  },
];

const countrySeg: Segment = {
  id: "country:jp",
  kind: "country",
  title: "Japan",
  camera: { center: [138, 36], zoom: 4 },
  patch: {},
  holdMs: 1000,
};

describe("selectWeatherPoint", () => {
  it("returns null with no on-air segment", () => {
    expect(selectWeatherPoint(null, windSeries)).toBeNull();
  });

  it("returns null when the archive has no usable samples for the point", () => {
    expect(selectWeatherPoint(countrySeg, [])).toBeNull();
  });

  it("returns the segment's centre + title once a monitor variable has enough samples", () => {
    expect(selectWeatherPoint(countrySeg, windSeries)).toEqual({ center: [138, 36], label: "Japan" });
  });

  it("hides on wide shots with no real ground location (e.g. intro/ocean/summary)", () => {
    const introSeg: Segment = { ...countrySeg, kind: "intro" };
    expect(selectWeatherPoint(introSeg, windSeries)).toBeNull();
  });

  it("hides on segments that already carry their own globe marker (quake/storm/volcano/flight/ship)", () => {
    for (const kind of ["quake", "storm", "volcano", "flight", "ship"] as const) {
      const seg: Segment = { ...countrySeg, kind };
      expect(selectWeatherPoint(seg, windSeries)).toBeNull();
    }
  });
});
