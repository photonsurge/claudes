import { buildCandidates } from "./candidates";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import type { AppDb } from "@photonsurge/shared/db/index";

/** Minimal fake DB facade exposing just what buildCandidates reads. */
function fakeDb(over: Partial<Record<string, any>> = {}): AppDb {
  return {
    quakes: {
      list: async () => over.quakes ?? [
        { quakeId: "q1", mag: 6.1, place: "Off Japan", lng: 140, lat: 38, tsunami: false },
      ],
    },
    alerts: {
      list: async () => over.alerts ?? [
        {
          source: "nws",
          identifier: "a1",
          maxSeverityRank: 4,
          info: [
            {
              event: "Hurricane Warning",
              area: [
                {
                  areaDesc: "Gulf Coast",
                  geometry: {
                    type: "Polygon",
                    coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    trackSnapshots: {
      latest: async ({ kind }: { kind: string }) => ({
        at: new Date(0),
        rows:
          kind === "aircraft"
            ? over.aircraft ?? [{ externalId: "abc123", name: "BAW123", country: "United Kingdom", lng: 0, lat: 51, altM: 11000 }]
            : over.ships ?? [{ externalId: "232000001", name: "Boaty", lng: 1, lat: 50, speed: 18, headingDeg: 90 }],
      }),
    },
    aircraftMeta: {
      getAll: async () => ({
        data: over.aircraftMeta ?? [
          { id: "abc123", type: "Boeing 747-400", operator: "British Airways", registration: "G-CIVA" },
        ],
      }),
    },
  } as unknown as AppDb;
}

const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({
  ...DEFAULT_DIRECTOR_CONFIG,
  ...over,
  kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, ...(over.kinds ?? {}) },
});

describe("buildCandidates", () => {
  it("always includes curated filler (intro + ocean + tours)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    expect(pool.some((c) => c.segment.id === "intro:global")).toBe(true);
    expect(pool.filter((c) => c.segment.kind === "tour").length).toBeGreaterThan(5);
  });

  it("adds global ocean spins that assert their own ocean variable", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const sst = pool.find((c) => c.segment.id === "ocean:sst");
    const waves = pool.find((c) => c.segment.id === "ocean:waves");
    expect(sst?.segment.patch.activeVariable).toBe("sst");
    expect(sst?.segment.patch.autoSpin).toBe(true); // world map spins
    expect(waves?.segment.patch.activeVariable).toBe("wave");
  });

  it("holds regional tours on their subject (no global spin)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const tour = pool.find((c) => c.segment.kind === "tour")!;
    expect(tour.segment.patch.autoSpin).toBe(false);
  });

  it("scores a big quake above filler and frames its epicentre", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const q = pool.find((c) => c.segment.id === "quake:q1");
    expect(q).toBeTruthy();
    expect(q!.score).toBeCloseTo(40 + 6.1 * 10); // 101
    expect(q!.segment.subtitle).toBe("M6.1 · Off Japan");
    expect(q!.segment.camera.center).toEqual([140, 38]);
    const tour = pool.find((c) => c.segment.kind === "tour")!;
    expect(q!.score).toBeGreaterThan(tour.score);
  });

  it("derives a storm centroid from the alert polygon", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const storm = pool.find((c) => c.segment.kind === "storm");
    expect(storm).toBeTruthy();
    expect(storm!.segment.id).toBe("storm:nws:a1");
    expect(storm!.segment.title).toBe("Hurricane Warning");
    const [lng, lat] = storm!.segment.camera.center;
    expect(lng).toBeCloseTo(-89.2, 1);
    expect(lat).toBeCloseTo(25.8, 1);
  });

  it("picks notable aircraft and ships from the latest frame", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    expect(pool.some((c) => c.segment.id === "flight:abc123")).toBe(true);
    expect(pool.some((c) => c.segment.id === "ship:232000001")).toBe(true);
  });

  it("enriches aircraft with flag, type and operator from cached meta", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const flight = pool.find((c) => c.segment.id === "flight:abc123")!;
    expect(flight.segment.subtitle).toBe("🇬🇧 Aircraft · FL361");
    const labels = (flight.segment.details ?? []).map((d) => d.label);
    expect(labels).toEqual(expect.arrayContaining(["Type", "Operator", "Registration", "Origin"]));
    expect(flight.segment.details).toEqual(
      expect.arrayContaining([
        { label: "Type", value: "Boeing 747-400" },
        { label: "Operator", value: "British Airways" },
        { label: "Origin", value: "🇬🇧 United Kingdom" },
      ]),
    );
  });

  it("derives a vessel flag from the MMSI MID", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const ship = pool.find((c) => c.segment.id === "ship:232000001")!;
    expect(ship.segment.subtitle).toBe("🇬🇧 Vessel · 18 kn");
    expect(ship.segment.details).toEqual(
      expect.arrayContaining([
        { label: "Flag", value: "🇬🇧 United Kingdom" },
        { label: "MMSI", value: "232000001" },
      ]),
    );
  });

  it("honours disabled kinds", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ kinds: { quake: false } as any }));
    expect(pool.some((c) => c.segment.kind === "quake")).toBe(false);
    // others still present
    expect(pool.some((c) => c.segment.kind === "storm")).toBe(true);
  });

  it("survives empty caches (filler still carries the show)", async () => {
    const empty = fakeDb({ quakes: [], alerts: [], aircraft: [], ships: [] });
    const pool = await buildCandidates(empty, cfg());
    expect(pool.length).toBeGreaterThan(0);
    // Filler kinds: the global intro, ocean spins, curated tours, and orbital
    // shots (gated to ingested TLE groups so they're never empty).
    const fillerKinds = new Set(["intro", "ocean", "orbital", "tour"]);
    expect(pool.every((c) => fillerKinds.has(c.segment.kind))).toBe(true);
  });
});
