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
    vehicles: {
      notableCatalog: async () => over.vehicles ?? [],
    },
    eventSummaries: {
      latest: async (period: string) => (over.eventSummaries ?? {})[period] ?? null,
    },
  } as unknown as AppDb;
}

const freshSummary = (over: Partial<Record<string, any>> = {}) => ({
  id: "sum1",
  period: "hourly",
  narrativeStatus: "ok",
  narrative: "Severe storms are impacting the Gulf Coast while a strong quake rattled Japan.",
  generatedAt: new Date(),
  hotspots: [],
  topEvents: [],
  ...over,
});

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

  it("adds one global ocean spin that opens on SST and spins (tours the rest client-side)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const ocean = pool.filter((c) => c.segment.kind === "ocean");
    // Collapsed from one-candidate-per-field to a single touring spin.
    expect(ocean.length).toBe(1);
    expect(ocean[0].segment.id).toBe("ocean:world");
    expect(ocean[0].segment.patch.activeVariable).toBe("sst"); // opens on the hero field
    expect(ocean[0].segment.patch.autoSpin).toBe(true); // world map spins
  });

  it("opens the ocean spin on the first operator-enabled map type, not always SST", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ mapTypes: { ocean: ["wave", "salinity"] } }));
    const ocean = pool.find((c) => c.segment.kind === "ocean")!;
    expect(ocean.segment.patch.activeVariable).toBe("wave");
  });

  it("holds regional tours on their subject (no global spin)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const tour = pool.find((c) => c.segment.kind === "tour")!;
    expect(tour.segment.patch.autoSpin).toBe(false);
  });

  it("spotlights the favourite countries with flag + national-weather framing", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const countries = pool.filter((c) => c.segment.kind === "country");
    // Defaults: UK + Japan, one spotlight each.
    expect(countries.map((c) => c.segment.id).sort()).toEqual(["country:japan", "country:uk"]);
    const uk = countries.find((c) => c.segment.id === "country:uk")!;
    expect(uk.segment.title).toBe("United Kingdom");
    expect(uk.segment.icon).toBe("🇬🇧");
    expect(uk.segment.patch.autoSpin).toBe(false); // holds on the country
    expect(uk.segment.patch.showAlerts).toBe(true); // the national warnings picture
    expect(uk.segment.patch.showRadar).toBe(true);
  });

  it("follows the operator's favourites list and skips unknown ids", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ countries: ["france", "atlantis"] }));
    const ids = pool.filter((c) => c.segment.kind === "country").map((c) => c.segment.id);
    expect(ids).toEqual(["country:france"]);
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

  it("layers an operator overlayOverride onto the preset without touching other kinds", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ overlayOverrides: { quake: { showFaults: false } } }));
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.showFaults).toBe(false);
    // The preset's other quake toggles are untouched.
    expect(q.segment.patch.showCables).toBe(true);
    // Unrelated kinds don't pick up the override.
    const tour = pool.find((c) => c.segment.kind === "tour")!;
    expect(tour.segment.patch.showFaults).toBe(false); // both default to false via LAYERS_OFF
    expect(tour.segment.patch.showWind).toBe(true); // tour's own preset untouched
  });

  it("layers a kindLooks basemap + wind override onto the preset without touching other kinds", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({ kindLooks: { quake: { basemap: "night", wind: { speedFactor: 16, color: "#cfe8ff" } } } }),
    );
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.basemap).toBe("night");
    expect(q.segment.patch.wind?.speedFactor).toBe(16);
    expect(q.segment.patch.wind?.color).toBe("#cfe8ff");
    // Unspecified wind fields fall back to DEFAULT_WIND_SETTINGS, not whatever's live.
    expect(q.segment.patch.wind?.numParticles).toBe(6000);
    // Unrelated kinds keep their own preset basemap/wind untouched.
    const tour = pool.find((c) => c.segment.kind === "tour")!;
    expect(tour.segment.patch.basemap).not.toBe("night");
    expect(tour.segment.patch.wind).toBeUndefined();
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

  it("boosts a catalogued VIP aircraft (any altitude) and attaches Track Info", async () => {
    const db = fakeDb({
      // altM 3000 is below the 9000m cruising-jet gate — it only makes the cut
      // because it's in the catalog, proving catalog match beats the altitude gate.
      aircraft: [{ externalId: "adfeb7", name: "AF1", country: "United States", lng: 0, lat: 51, altM: 3000 }],
      aircraftMeta: [],
      vehicles: [
        {
          id: "aircraft:adfeb7", kind: "aircraft", code: "adfeb7", label: "Air Force One",
          category: "government", enabled: true, vip: true, type: "Boeing VC-25A",
          photoUrl: "https://cdn/af1.jpg", wikiExtract: "The VC-25A…",
        },
      ],
    });
    const pool = await buildCandidates(db, cfg());
    const flight = pool.find((c) => c.segment.id === "flight:adfeb7")!;
    expect(flight).toBeTruthy();
    expect(flight.score).toBe(80); // VIP_SCORE — well above the generic 18
    expect(flight.segment.title).toBe("Air Force One");
    expect(flight.segment.trackInfo).toMatchObject({
      label: "Air Force One", type: "Boeing VC-25A", photoUrl: "https://cdn/af1.jpg",
      notable: true, vip: true,
    });
  });

  it("boosts a catalogued ship (any speed) and attaches Track Info", async () => {
    const db = fakeDb({
      // speed 3kn is below the 12kn fast-mover gate — catalog match includes it.
      ships: [{ externalId: "310627000", name: "QM2", lng: 1, lat: 50, speed: 3, headingDeg: 90 }],
      vehicles: [
        { id: "ship:310627000", kind: "ship", code: "310627000", label: "Queen Mary 2", enabled: true, type: "Ocean liner", wikiExtract: "A liner…" },
      ],
    });
    const pool = await buildCandidates(db, cfg());
    const ship = pool.find((c) => c.segment.id === "ship:310627000")!;
    expect(ship.score).toBe(45); // NOTABLE_SCORE (not a VIP)
    expect(ship.segment.title).toBe("Queen Mary 2");
    expect(ship.segment.trackInfo).toMatchObject({ label: "Queen Mary 2", notable: true });
  });

  it("stamps per-kind and per-event-level holds onto segments", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({
        kindHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds, tour: 20 },
        quakeHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.quakeHoldSeconds, strong: 25 },
        stormHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.stormHoldSeconds, extreme: 40 },
      }),
    );
    expect(pool.find((c) => c.segment.kind === "tour")!.segment.holdMs).toBe(20_000);
    // The fake quake is M6.1 → "strong"; the fake alert is severityRank 4 → "extreme".
    expect(pool.find((c) => c.segment.id === "quake:q1")!.segment.holdMs).toBe(25_000);
    expect(pool.find((c) => c.segment.kind === "storm")!.segment.holdMs).toBe(40_000);
    // Untouched kinds keep their own defaults (world spins run long).
    expect(pool.find((c) => c.segment.id === "intro:global")!.segment.holdMs).toBe(17_000);
    expect(pool.find((c) => c.segment.kind === "ship")!.segment.holdMs).toBe(12_000);
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
    // Filler kinds: the global intro, ocean spins, curated tours, country
    // spotlights, and orbital shots (gated to ingested TLE groups so they're
    // never empty).
    const fillerKinds = new Set(["intro", "ocean", "orbital", "tour", "country"]);
    expect(pool.every((c) => fillerKinds.has(c.segment.kind))).toBe(true);
  });

  describe("round-up summary candidates", () => {
    it("adds a candidate for a fresh, successful hourly round-up", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const pool = await buildCandidates(db, cfg());
      const summary = pool.find((c) => c.segment.id === "summary:sum1");
      expect(summary).toBeTruthy();
      expect(summary!.segment.summary?.narrative).toContain("Gulf Coast");
      expect(summary!.segment.summary?.period).toBe("hourly");
    });

    it("tours the round-up's hotspots then its named top events as camera stops", async () => {
      const db = fakeDb({
        eventSummaries: {
          hourly: freshSummary({
            hotspots: [
              { label: "Gulf Coast", lng: -90, lat: 27, count: 3, maxSeverity: 4, hazards: ["Hurricane"], kinds: ["alert"] },
            ],
            topEvents: [
              { kind: "quake", refId: "q1", title: "M6.1 — Off Japan", severity: 3, hazard: undefined, lng: 140, lat: 38 },
              { kind: "alert", refId: "a-no-geo", title: "Geocode-only advisory", severity: 1 }, // no lng/lat — dropped
            ],
          }),
        },
      });
      const pool = await buildCandidates(db, cfg());
      const summary = pool.find((c) => c.segment.id === "summary:sum1")!;
      expect(summary.segment.summary?.stops).toEqual([
        { label: "Gulf Coast", subtitle: "Hurricane · 3 events", lng: -90, lat: 27, severity: 4 },
        { label: "M6.1 — Off Japan", subtitle: undefined, lng: 140, lat: 38, severity: 3 },
      ]);
    });

    it("skips a summary with no successful narrative (skipped/error/empty)", async () => {
      const db = fakeDb({
        eventSummaries: {
          hourly: freshSummary({ narrativeStatus: "skipped", narrative: "" }),
          "12h": freshSummary({ id: "sum2", period: "12h", narrativeStatus: "ok", narrative: "   " }),
        },
      });
      const pool = await buildCandidates(db, cfg());
      expect(pool.some((c) => c.segment.kind === "summary")).toBe(false);
    });

    it("never re-airs a summary already shown this session", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const seen = new Map([["summary:sum1", 1]]);
      const pool = await buildCandidates(db, cfg(), seen);
      expect(pool.some((c) => c.segment.kind === "summary")).toBe(false);
    });

    it("skips a stale round-up the director missed while off", async () => {
      const stale = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h old hourly round-up
      const db = fakeDb({ eventSummaries: { hourly: freshSummary({ generatedAt: stale }) } });
      const pool = await buildCandidates(db, cfg());
      expect(pool.some((c) => c.segment.kind === "summary")).toBe(false);
    });

    it("honours the summary kind toggle", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const pool = await buildCandidates(db, cfg({ kinds: { summary: false } as any }));
      expect(pool.some((c) => c.segment.kind === "summary")).toBe(false);
    });

    it("builds camera stops from hotspots then geocoded top events", async () => {
      const db = fakeDb({
        eventSummaries: {
          hourly: freshSummary({
            hotspots: [
              { label: "Gulf Coast", lng: -90, lat: 29, count: 3, maxSeverity: 4, hazards: ["wind"], kinds: ["alert"] },
            ],
            topEvents: [
              { kind: "quake", refId: "q1", title: "M6.5 — Off Japan", severity: 4, lng: 140, lat: 38 },
              { kind: "quake", refId: "q2", title: "No coords", severity: 3 }, // dropped: no lng/lat
            ],
          }),
        },
      });
      const pool = await buildCandidates(db, cfg());
      const stops = pool.find((c) => c.segment.id === "summary:sum1")!.segment.summary!.stops!;
      expect(stops).toEqual([
        { label: "Gulf Coast", subtitle: "wind · 3 events", lng: -90, lat: 29, severity: 4 },
        { label: "M6.5 — Off Japan", subtitle: undefined, lng: 140, lat: 38, severity: 4 },
      ]);
    });
  });
});
