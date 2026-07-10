import {
  polysOf,
  unionBbox,
  spansAntimeridian,
  largestPoly,
  projectPoint,
  canvasSizeFor,
  glowBreath,
  countryMapGlowLayers,
  _clearBakeCache,
  type Poly,
} from "./countryMapGlow";

const square = (w: number, s: number, e: number, n: number): Poly => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
];

function polygonFeature(iso2: string, [w, s, e, n]: [number, number, number, number]) {
  return {
    type: "Feature",
    properties: { iso_a2: iso2 },
    geometry: { type: "Polygon", coordinates: square(w, s, e, n) },
  };
}

describe("polysOf", () => {
  it("wraps a Polygon as one part", () => {
    expect(polysOf({ type: "Polygon", coordinates: square(0, 0, 1, 1) })).toHaveLength(1);
  });
  it("returns every part of a MultiPolygon", () => {
    expect(
      polysOf({ type: "MultiPolygon", coordinates: [square(0, 0, 1, 1), square(2, 2, 3, 3)] }),
    ).toHaveLength(2);
  });
  it("is empty for a non-polygon geometry", () => {
    expect(polysOf({ type: "Point", coordinates: [0, 0] })).toEqual([]);
    expect(polysOf(null)).toEqual([]);
  });
});

describe("unionBbox", () => {
  it("spans every part's outer ring", () => {
    expect(unionBbox([square(-10, 36, -6, 42), square(-9, 40, 3, 44)])).toEqual([-10, 36, 3, 44]);
  });
  it("is null with no points", () => {
    expect(unionBbox([])).toBeNull();
  });
});

describe("spansAntimeridian", () => {
  it("flags a bbox wider than half the globe (collapsed straddle)", () => {
    expect(spansAntimeridian([-179, 50, 179, 70])).toBe(true);
  });
  it("passes a normal country bbox", () => {
    expect(spansAntimeridian([-10, 36, 3, 44])).toBe(false);
  });
});

describe("largestPoly", () => {
  it("picks the part with the biggest bbox area", () => {
    const big = square(0, 0, 40, 30);
    const small = square(170, 0, 179, 5);
    const chosen = largestPoly([small, big]);
    expect(chosen).toBe(big);
  });
});

describe("projectPoint", () => {
  const bbox: [number, number, number, number] = [-10, 30, 10, 50];
  it("puts the NW corner at the canvas origin", () => {
    expect(projectPoint([-10, 50], bbox, 200, 200)).toEqual([0, 0]);
  });
  it("puts the SE corner at the far edge", () => {
    expect(projectPoint([10, 30], bbox, 200, 200)).toEqual([200, 200]);
  });
  it("maps the centre to the middle (north at top)", () => {
    expect(projectPoint([0, 40], bbox, 200, 200)).toEqual([100, 100]);
  });
});

describe("canvasSizeFor", () => {
  it("uses the image resolution for a small country", () => {
    // 20°×20° window of a 3600×1800 image = 200×200 px, under the cap.
    expect(canvasSizeFor([-10, 30, 10, 50], 3600, 1800, 2048)).toEqual({ cw: 200, ch: 200 });
  });
  it("caps a very wide country to maxTex on its long axis", () => {
    // Full-width country would be 3600px wide → scaled to the 2048 cap.
    const { cw } = canvasSizeFor([-180, 0, 180, 30], 3600, 1800, 2048);
    expect(cw).toBe(2048);
  });
});

describe("glowBreath", () => {
  it("is 0 at the start of a period and 1 at the half", () => {
    expect(glowBreath(0, 2600)).toBeCloseTo(0);
    expect(glowBreath(1300, 2600)).toBeCloseTo(1);
  });
  it("handles negative now without going out of [0,1]", () => {
    const v = glowBreath(-100, 2600);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("countryMapGlowLayers", () => {
  beforeEach(() => _clearBakeCache());

  it("returns [] when there is nothing to glow", () => {
    expect(countryMapGlowLayers([], { width: 3600, height: 1800 }, 0)).toEqual([]);
  });

  it("returns [] when the source image hasn't loaded", () => {
    expect(countryMapGlowLayers([polygonFeature("PT", [-10, 36, -6, 42])], null, 0)).toEqual([]);
  });

  it("omits a feature whose canvas can't bake (no 2d context)", () => {
    // No 2d context (SSR / headless) → the bake returns null and the feature is
    // skipped rather than throwing; the caller then keeps the cyan fallback.
    const spy = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null as unknown as CanvasRenderingContext2D);
    try {
      expect(
        countryMapGlowLayers([polygonFeature("PT", [-10, 36, -6, 42])], { width: 3600, height: 1800 }, 0),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("builds one BitmapLayer per feature, bounded to the country, over a stub context", () => {
    // A minimal 2d-context stub lets the real bake+layer path run (the deck.gl
    // BitmapLayer is mocked to just capture props).
    const ctx = {
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
      filter: "none",
    };
    const spy = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      const layers = countryMapGlowLayers(
        [polygonFeature("PT", [-10, 36, -6, 42])],
        { width: 3600, height: 1800 },
        0,
      ) as { props: { id: string; bounds: number[]; opacity: number } }[];
      expect(layers).toHaveLength(1);
      expect(layers[0].props.id).toBe("country-map-glow-0");
      expect(layers[0].props.bounds).toEqual([-10, 36, -6, 42]);
      expect(ctx.clip).toHaveBeenCalled();
      expect(ctx.drawImage).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the largest part for an antimeridian straddler", () => {
    const ctx = {
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
      filter: "none",
    };
    const spy = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    try {
      const straddler = {
        type: "Feature",
        properties: { iso_a2: "RU" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [square(30, 50, 179, 70), square(-179, 50, -170, 70)],
        },
      };
      const layers = countryMapGlowLayers(
        [straddler],
        { width: 3600, height: 1800 },
        0,
      ) as { props: { bounds: number[] } }[];
      // Bounded to the big western part, not the bogus [-179,179] union.
      expect(layers[0].props.bounds).toEqual([30, 50, 179, 70]);
    } finally {
      spy.mockRestore();
    }
  });
});
