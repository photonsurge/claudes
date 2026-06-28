import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { stepFhrs, fhrIndex, neighbourFhr, neighbourUrls } from "./timeline-utils";

const manifest: WeatherManifest = {
  model: "gfs",
  run: "2026-06-28T12:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 4, height: 2, res: 90 },
  steps: [
    { validTime: "a", fhr: 0 },
    { validTime: "b", fhr: 3 },
    { validTime: "c", fhr: 6 },
  ],
  variables: {
    temp: {
      encoding: "scalar",
      units: "°C",
      files: { "0": "/tex/t0", "3": "/tex/t3", "6": "/tex/t6" },
    },
    wind: {
      encoding: "uv",
      units: "m/s",
      imageUnscale: [-30, 30],
      files: { "0": "/tex/w0", "3": "/tex/w3", "6": "/tex/w6" },
    },
  },
};

describe("timeline-utils", () => {
  it("lists step fhrs and indices", () => {
    expect(stepFhrs(manifest)).toEqual([0, 3, 6]);
    expect(fhrIndex(manifest, 3)).toBe(1);
    expect(fhrIndex(manifest, 99)).toBe(0);
  });

  it("wraps neighbour fhr", () => {
    expect(neighbourFhr(manifest, 0, 1)).toBe(3);
    expect(neighbourFhr(manifest, 0, -1)).toBe(6); // wrap to last
    expect(neighbourFhr(manifest, 6, 1)).toBe(0); // wrap to first
  });

  it("collects neighbour texture URLs for the given variables", () => {
    const urls = neighbourUrls(manifest, 3, ["temp", "wind"]);
    expect(urls).toEqual(
      expect.arrayContaining(["/tex/t0", "/tex/t6", "/tex/w0", "/tex/w6"]),
    );
    expect(urls).not.toContain("/tex/t3");
  });
});
