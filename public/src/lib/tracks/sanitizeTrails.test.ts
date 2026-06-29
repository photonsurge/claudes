import { sanitizeTrails } from "./useTracks";
import type { TrackPath } from "./client";

const p = (externalId: string, path: [number, number][]): TrackPath => ({
  externalId,
  kind: "ship",
  path,
});

describe("sanitizeTrails", () => {
  it("keeps a normal contiguous trail intact", () => {
    const out = sanitizeTrails([p("211000000", [[0, 0], [0.1, 0.1], [0.2, 0.2]])]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toHaveLength(3);
  });

  it("drops junk / placeholder ids (empty or all-zero MMSI)", () => {
    expect(sanitizeTrails([p("0", [[0, 0], [40, 40]])])).toHaveLength(0);
    expect(sanitizeTrails([p("000000000", [[0, 0], [40, 40]])])).toHaveLength(0);
    expect(sanitizeTrails([p("", [[0, 0], [40, 40]])])).toHaveLength(0);
  });

  it("splits a path at an impossible jump (teleport / coverage gap)", () => {
    // two tight clusters far apart → two segments, the cross-globe link dropped
    const out = sanitizeTrails([
      p("211000000", [[0, 0], [0.1, 0], [50, 50], [50.1, 50]]),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].path).toEqual([[0, 0], [0.1, 0]]);
    expect(out[1].path).toEqual([[50, 50], [50.1, 50]]);
  });

  it("drops orphan single points left by a split", () => {
    // middle point is isolated by jumps on both sides → no 2-point segment around it
    const out = sanitizeTrails([p("211000000", [[0, 0], [0.1, 0], [80, 0]])]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toEqual([[0, 0], [0.1, 0]]);
  });

  it("does not split a genuine antimeridian crossing", () => {
    const out = sanitizeTrails([p("211000000", [[179, 10], [-179.5, 10.2]])]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toHaveLength(2);
  });
});
