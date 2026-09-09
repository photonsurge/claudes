import { GeoGrid, bearingLabel, compass16, formatKm, haversineKm, initialBearingDeg, nearby, nearest, radiusBox, withinBbox, withinRadiusBox } from "./geo";

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

describe("radiusBox pre-cull", () => {
  /** Deterministic LCG so the property test is reproducible. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it("never drops a point the exact haversine would keep (random centres, radii, latitudes)", () => {
    const rand = rng(42);
    const pts: [number, number][] = [];
    for (let i = 0; i < 4000; i++) pts.push([rand() * 360 - 180, rand() * 180 - 90]);
    // Dense samples right at the dateline and near the poles, where a naive box breaks.
    for (let i = 0; i < 400; i++) {
      pts.push([179.5 + rand(), rand() * 160 - 80]);
      pts.push([-180 + rand() * 0.5, rand() * 160 - 80]);
      pts.push([rand() * 360 - 180, 85 + rand() * 5]);
    }
    const centres: [number, number][] = [
      [0, 0],
      [179.9, 10],
      [-179.9, -10],
      [10, 60],
      [-100, 75],
      [30, 86],
      [-45, -88],
      [140, 45],
    ];
    for (const c of centres) {
      for (const radiusKm of [5, 50, 350, 1500, 4000]) {
        const box = radiusBox(c, radiusKm);
        for (const p of pts) {
          if (haversineKm(c, p) <= radiusKm) expect(withinRadiusBox(c, p, box)).toBe(true);
        }
      }
    }
  });

  it("gives the same result as the brute-force scan, in the same order", () => {
    const rand = rng(7);
    const items = Array.from({ length: 3000 }, (_, i) => ({ i, lng: rand() * 360 - 180, lat: rand() * 180 - 90 }));
    const getPoint = (x: (typeof items)[number]): [number, number] => [x.lng, x.lat];
    for (const c of [[0, 0], [179.5, 60], [-30, -85]] as [number, number][]) {
      const brute = items
        .map((item) => ({ item, distanceKm: haversineKm(c, getPoint(item)) }))
        .filter((x) => x.distanceKm <= 2000)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map((x) => x.item.i);
      expect(nearby(items, c, getPoint, 2000).map((x) => x.item.i)).toEqual(brute);
    }
  });

  it("spans every longitude once the box touches a pole", () => {
    expect(radiusBox([0, 89], 500).dLng).toBe(180);
    expect(radiusBox([0, 0], 500).dLng).toBeLessThan(10);
  });

  it("is dateline-aware", () => {
    const box = radiusBox([179.9, 0], 100);
    expect(withinRadiusBox([179.9, 0], [-179.9, 0], box)).toBe(true);
    expect(withinRadiusBox([179.9, 0], [170, 0], box)).toBe(false);
  });
});

describe("GeoGrid (bucketed nearby)", () => {
  // Deterministic pseudo-random cities over the whole globe, dateline and poles included.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cities = Array.from({ length: 4000 }, (_, i) => ({
    id: i,
    lng: -180 + rnd() * 360,
    lat: -90 + rnd() * 180,
  }));
  const pt = (c: { lng: number; lat: number }): [number, number] => [c.lng, c.lat];
  const grid = new GeoGrid(cities, pt);

  it("answers exactly what nearby() answers, in the same order", () => {
    const centres: [number, number][] = [
      [0, 51.5],
      [179.9, -41],
      [-179.5, 64],
      [12, 89.5],
      [-70, -88],
      [139.7, 35.7],
      [-0.4, 0.2],
    ];
    for (const c of centres) {
      for (const r of [80, 350, 1200]) {
        const a = nearby(cities, c, pt, r);
        const b = grid.nearby(c, r);
        expect(b.map((x) => x.item.id)).toEqual(a.map((x) => x.item.id));
        expect(b.map((x) => x.distanceKm)).toEqual(a.map((x) => x.distanceKm));
      }
    }
  });

  it("keeps equal distances in the items' original order, like nearby()", () => {
    const twins = [
      { id: "b", lng: 1, lat: 0 },
      { id: "a", lng: -1, lat: 0 },
      { id: "c", lng: 0, lat: 0.5 },
    ];
    const g = new GeoGrid(twins, (t) => [t.lng, t.lat]);
    expect(g.nearby([0, 0], 500).map((x) => x.item.id)).toEqual(["c", "b", "a"]);
    expect(nearby(twins, [0, 0], (t) => [t.lng, t.lat], 500).map((x) => x.item.id)).toEqual(["c", "b", "a"]);
    // nearest() is nearby()[0], ties included: drop "c" and the twins tie at 111 km.
    expect(g.nearest([0, 0], 500)?.item.id).toBe("c");
    expect(g.nearest([0, 0], 60)?.item.id).toBe("c");
    expect(new GeoGrid(twins.slice(0, 2), (t) => [t.lng, t.lat]).nearest([0, 0], 500)?.item.id).toBe("b");
  });

  it("nearest() is nearby()[0] everywhere, and null out of range", () => {
    const centres: [number, number][] = [[0, 51.5], [179.9, -41], [-179.5, 64], [12, 89.5], [-70, -88], [139.7, 35.7]];
    for (const c of centres) {
      for (const r of [80, 350, 1200]) {
        const first = grid.nearby(c, r)[0] ?? null;
        expect(grid.nearest(c, r)).toEqual(first);
      }
    }
    expect(grid.nearest([0, 0], 0.001)).toBeNull();
  });

  it("skips items without a location", () => {
    const g = new GeoGrid([{ id: 1, p: null }, { id: 2, p: [0, 0] as [number, number] }], (t) => t.p);
    expect(g.nearby([0, 0], 10).map((x) => x.item.id)).toEqual([2]);
  });
});
