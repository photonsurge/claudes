import {
  haversineKm,
  nearby,
  nearest,
  formatKm,
  initialBearingDeg,
  compass16,
  bearingLabel,
  withinBbox,
} from "./geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm([0, 0], [0, 0])).toBe(0);
  });

  it("matches a known distance (London → Paris ≈ 344 km)", () => {
    const d = haversineKm([-0.1276, 51.5074], [2.3522, 48.8566]);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it("is symmetric", () => {
    const a: [number, number] = [10, 20];
    const b: [number, number] = [-30, 40];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("nearby", () => {
  const pts = [
    { name: "here", lng: 0, lat: 0 },
    { name: "close", lng: 0.5, lat: 0 },
    { name: "far", lng: 30, lat: 0 },
    { name: "noloc", lng: NaN, lat: NaN },
  ];
  const getPoint = (p: (typeof pts)[number]): [number, number] | null =>
    Number.isFinite(p.lng) && Number.isFinite(p.lat) ? [p.lng, p.lat] : null;

  it("keeps only items within the radius, nearest first", () => {
    const r = nearby(pts, [0, 0], getPoint, 200);
    expect(r.map((x) => x.item.name)).toEqual(["here", "close"]);
    expect(r[0].distanceKm).toBeLessThanOrEqual(r[1].distanceKm);
  });

  it("skips items with no location", () => {
    const r = nearby(pts, [0, 0], getPoint, 100_000);
    expect(r.some((x) => x.item.name === "noloc")).toBe(false);
  });

  it("returns empty when nothing is in range", () => {
    expect(nearby(pts, [100, 80], getPoint, 10)).toEqual([]);
  });
});

describe("nearest", () => {
  const pts = [
    { name: "close", lng: 0.5, lat: 0 },
    { name: "far", lng: 30, lat: 0 },
    { name: "noloc", lng: NaN, lat: NaN },
  ];
  const getPoint = (p: (typeof pts)[number]): [number, number] | null =>
    Number.isFinite(p.lng) && Number.isFinite(p.lat) ? [p.lng, p.lat] : null;

  it("returns the single closest item regardless of distance (no radius bound)", () => {
    const r = nearest(pts, [25, 0], getPoint); // near lng 25 → 'far' (lng 30) wins over 'close' (lng 0.5)
    expect(r?.item.name).toBe("far");
    expect(r?.distanceKm).toBeGreaterThan(0);
  });

  it("names the closest landfall even when it's far away (mid-ocean case)", () => {
    const r = nearest(pts, [-90, -40], getPoint);
    expect(r?.item.name).toBe("close");
  });

  it("is null when no item has a location", () => {
    expect(nearest([{ name: "noloc", lng: NaN, lat: NaN }], [0, 0], getPoint)).toBeNull();
  });
});

describe("formatKm", () => {
  it("keeps one decimal under 10 km, rounds above", () => {
    expect(formatKm(4.23)).toBe("4.2 km");
    expect(formatKm(132.7)).toBe("133 km");
  });
});

describe("initialBearingDeg / compass16", () => {
  const origin: [number, number] = [0, 0];
  it("points to the cardinal directions", () => {
    expect(initialBearingDeg(origin, [0, 10])).toBeCloseTo(0, 4); // due north
    expect(initialBearingDeg(origin, [10, 0])).toBeCloseTo(90, 4); // due east
    expect(initialBearingDeg(origin, [0, -10])).toBeCloseTo(180, 4); // due south
    expect(initialBearingDeg(origin, [-10, 0])).toBeCloseTo(270, 4); // due west
  });

  it("maps degrees to 16-point compass abbreviations", () => {
    expect(compass16(0)).toBe("N");
    expect(compass16(45)).toBe("NE");
    expect(compass16(90)).toBe("E");
    expect(compass16(200)).toBe("SSW");
    expect(compass16(359)).toBe("N"); // wraps back to north
  });

  it("bearingLabel names the epicentre direction from a city", () => {
    // A quake to the north-east of a city reads "NE".
    expect(bearingLabel([0, 0], [3, 3])).toBe("NE");
  });
});

describe("withinBbox", () => {
  const portugal: [number, number, number, number] = [-9.6, 36.8, -6.1, 42.2];

  it("is true for a point inside the box", () => {
    expect(withinBbox(-9.14, 38.72, portugal)).toBe(true); // Lisbon
  });

  it("is false for a point outside the box", () => {
    expect(withinBbox(2.35, 48.86, portugal)).toBe(false); // Paris
  });

  it("is true exactly on the box edges", () => {
    expect(withinBbox(-9.6, 36.8, portugal)).toBe(true);
    expect(withinBbox(-6.1, 42.2, portugal)).toBe(true);
  });

  it("wraps the antimeridian when west > east", () => {
    const wraps: [number, number, number, number] = [170, -10, -170, 10];
    expect(withinBbox(175, 0, wraps)).toBe(true);
    expect(withinBbox(-175, 0, wraps)).toBe(true);
    expect(withinBbox(0, 0, wraps)).toBe(false);
  });
});
