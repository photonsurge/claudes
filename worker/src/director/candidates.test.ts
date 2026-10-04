import {
  buildCandidates,
  quakeCandidate,
  stormCandidate,
  summaryCandidate,
  summaryTourHoldMs,
  volcanoCandidate,
} from "./candidates";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig } from "@photonsurge/shared/director";
import { DEFAULT_DIRECTOR_TOURS } from "@photonsurge/shared/director-tuning";
import { SEED_SEA_POINTS } from "@photonsurge/shared/director-sea-points";
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
      // Flight/ship candidates are catalog-gated now — the default fixtures
      // model an already-enriched craft/vessel so the plain "picks notable
      // aircraft/ships" tests below don't need to restate the catalog match.
      notableCatalog: async () => over.vehicles ?? [
        { id: "aircraft:abc123", kind: "aircraft", code: "abc123", name: "BAW123", enabled: true, notable: true },
        { id: "ship:232000001", kind: "ship", code: "232000001", name: "Boaty", enabled: true, notable: true },
      ],
    },
    eventSummaries: {
      latest: async (period: string) => (over.eventSummaries ?? {})[period] ?? null,
    },
    volcanoes: {
      list: async () => over.volcanoes ?? [],
    },
    seaPoints: {
      list: async () => over.seaPoints ?? SEED_SEA_POINTS,
    },
    regions: {
      // Region tours read the curated, member-country-scoped `topCities` dossier
      // off the Region doc. Default: a couple of European cities so a "europe"
      // favourite tours; override with `over.region` per test (incl. topCities: []).
      get: async (regionId: string) =>
        over.region ?? {
          regionId,
          topCities: [
            { name: "London", country: "United Kingdom", cc: "gb", lng: -0.13, lat: 51.5, population: 8_900_000 },
            { name: "Paris", country: "France", cc: "fr", lng: 2.35, lat: 48.85, population: 2_100_000 },
          ],
        },
    },
    countries: {
      // Country spotlights read the precomputed tour dossier off the Country doc,
      // keyed by iso2-lowercased. Default: no dossier (null) so a favourite airs
      // as the curated single framed shot — pass `over.countries` (a map keyed by
      // countryId) to give a country a computed tour.
      get: async (countryId: string) => (over.countries ?? {})[countryId] ?? null,
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
  it("always includes curated filler (intro opener + recurring global spin + ocean + countries)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    expect(pool.some((c) => c.segment.id === "intro:global")).toBe(true);
    expect(pool.some((c) => c.segment.id === "global:world")).toBe(true);
    expect(pool.some((c) => c.segment.kind === "country")).toBe(true);
  });

  it("adds one global ocean spin that opens on SST and spins (tours the rest client-side)", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const ocean = pool.filter((c) => c.segment.kind === "ocean");
    // The spin, plus one held-still candidate per enabled DB sea point.
    expect(ocean.length).toBe(1 + SEED_SEA_POINTS.length);
    const spin = ocean.find((c) => c.segment.id === "ocean:world")!;
    expect(spin.segment.patch.activeVariable).toBe("sst"); // opens on the hero field
    expect(spin.segment.patch.autoSpin).toBe(true); // world map spins
  });

  it("spotlights every enabled sea point, non-depth-cycle points held still", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const ocean = pool.filter((c) => c.segment.kind === "ocean");
    for (const p of SEED_SEA_POINTS.filter((sp) => !sp.depthCycle)) {
      const seg = ocean.find((c) => c.segment.id === `ocean:${p.pointId}`)!;
      expect(seg).toBeDefined();
      expect(seg.segment.title).toBe(p.name);
      expect(seg.segment.camera.center).toEqual([p.lng, p.lat]);
      expect(seg.segment.patch.activeVariable).toBe("sst");
      expect(seg.segment.patch.autoSpin).toBe(false); // holds on the point
      expect(seg.segment.depthCycle).toBe(false);
    }
  });

  it("depth-cycle monitoring points (Niño/MDR/North Sea/Med/IOD) drift slowly instead of holding still", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const ocean = pool.filter((c) => c.segment.kind === "ocean");
    for (const p of SEED_SEA_POINTS.filter((sp) => sp.depthCycle)) {
      const seg = ocean.find((c) => c.segment.id === `ocean:${p.pointId}`)!;
      expect(seg).toBeDefined();
      expect(seg.segment.patch.activeVariable).toBe("sst");
      expect(seg.segment.patch.autoSpin).toBe(true);
      expect(seg.segment.patch.spinSpeed).toBe(2.5);
      expect(seg.segment.depthCycle).toBe(true);
    }
  });

  it("drops every ocean candidate — spin AND sea points — when the kind is disabled", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ kinds: { ocean: false } }));
    expect(pool.filter((c) => c.segment.kind === "ocean")).toEqual([]);
  });

  it("excludes a sea point the admin has disabled, without touching the rest", async () => {
    const seaPoints = SEED_SEA_POINTS.map((p) => (p.pointId === "gulf-stream" ? { ...p, enabled: false } : p));
    const pool = await buildCandidates(fakeDb({ seaPoints }), cfg());
    const ocean = pool.filter((c) => c.segment.kind === "ocean");
    expect(ocean.find((c) => c.segment.id === "ocean:gulf-stream")).toBeUndefined();
    expect(ocean.length).toBe(SEED_SEA_POINTS.length); // world spin + all but the disabled one
  });

  it("opens the ocean spin on the first operator-enabled map type, not always SST", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ mapTypes: { ocean: ["wave", "salinity"] } }));
    const ocean = pool.find((c) => c.segment.kind === "ocean")!;
    expect(ocean.segment.patch.activeVariable).toBe("wave");
  });

  it("spotlights the favourite countries with flag + national-weather framing", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const countries = pool.filter((c) => c.segment.kind === "country");
    // Defaults: UK + Japan, one spotlight each.
    expect(countries.filter((c) => c.weight === 5).map((c) => c.segment.id).sort()).toEqual(["country:japan", "country:uk"]);
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
    expect(ids).toContain("country:france");
    expect(ids).toContain("country:japan");
    expect(ids).not.toContain("country:atlantis");
    expect(pool.find((c) => c.segment.id === "country:france")?.weight).toBe(5);
  });

  it("flies a country's precomputed city tour — opening on a wide establishing centre", async () => {
    const pool = await buildCandidates(
      fakeDb({
        countries: {
          // Keyed by countryId (iso2-lowercased); UK's curated shot has iso2 "GB".
          gb: {
            countryId: "gb",
            iso2: "GB",
            tourCentroid: [-2.0, 53.5],
            tourFrame: { center: [-2.0, 54.0], zoom: 4.4 },
            tourCities: [
              { name: "London", cc: "gb", lng: -0.13, lat: 51.5, population: 8_900_000, sector: 4 },
              { name: "Glasgow", cc: "gb", lng: -4.25, lat: 55.86, population: 600_000, sector: 0 },
            ],
          },
        },
      }),
      cfg({ countries: ["uk"] }),
    );
    const uk = pool.find((c) => c.segment.id === "country:uk")!.segment;
    expect(uk.subtitle).toBe("Country tour · National weather");
    // Establishing centre stop first (wide, carries the frame zoom), then cities.
    expect(uk.tourStops?.[0]).toMatchObject({ label: "United Kingdom", lng: -2.0, lat: 53.5, zoom: 4.4, iso2: "GB" });
    expect(uk.tourStops?.slice(1).map((s) => s.label)).toEqual(["London", "Glasgow"]);
    // City stops carry no per-stop zoom (default flyer zoom applies).
    expect(uk.tourStops?.[1].zoom).toBeUndefined();
    // The segment frames on the computed tour frame, and holds long enough to fly
    // every stop rather than the bare per-kind minimum.
    expect(uk.camera).toEqual({ center: [-2.0, 54.0], zoom: 4.4 });
    expect(uk.holdMs).toBeGreaterThan(uk.tourStops!.length * 40_000);
  });

  it("falls back to a single framed spotlight when a favourite has no computed tour", async () => {
    // No dossier for Japan → the curated framed shot, no tour stops.
    const pool = await buildCandidates(fakeDb(), cfg({ countries: ["japan"] }));
    const jp = pool.find((c) => c.segment.id === "country:japan")!.segment;
    expect(jp.tourStops).toBeUndefined();
    expect(jp.subtitle).toBe("Country spotlight · National weather");
  });

  it("adds only favourite region tours when favourites are selected", async () => {
    // Off by default → no region candidates even though the catalog exists.
    const off = await buildCandidates(fakeDb(), cfg());
    expect(off.some((c) => c.segment.kind === "region")).toBe(false);
    // Enabled + a favourite area → one derived-framing region tour; unknown ids skipped.
    const on = await buildCandidates(
      fakeDb(),
      cfg({ kinds: { region: true }, regions: ["europe", "atlantis"] }),
    );
    const regions = on.filter((c) => c.segment.kind === "region");
    expect(regions.filter((c) => c.weight === 5).map((c) => c.segment.id)).toEqual(["region:europe"]);
    expect(regions.length).toBeGreaterThan(1);
    const eu = regions.find((c) => c.segment.id === "region:europe")!.segment;
    expect(eu.patch.autoSpin).toBe(false); // holds/orbits on the area like a country
    expect(eu.camera.zoom).toBeGreaterThan(0);
  });

  it("tours a multi-country area's TOP COUNTRIES — captioned by country, never cities", async () => {
    const on = await buildCandidates(
      fakeDb({
        region: {
          regionId: "europe",
          // Curated topCities are already population-ranked and scoped to member
          // countries (regions.enrichPlaces) — the tour never re-queries by bbox.
          topCities: [
            { name: "Berlin", country: "Germany", cc: "de", lng: 13.4, lat: 52.5, population: 3_600_000 },
            { name: "Madrid", country: "Spain", cc: "es", lng: -3.7, lat: 40.4, population: 3_200_000 },
            { name: "Hamburg", country: "Germany", cc: "de", lng: 10.0, lat: 53.55, population: 1_800_000 },
          ],
        },
      }),
      cfg({ kinds: { region: true }, regions: ["europe"] }),
    );
    const eu = on.find((c) => c.segment.kind === "region")!.segment;
    // One stop per COUNTRY, labelled by the country (not the city). Germany leads
    // (Berlin+Hamburg presence) and is framed on Berlin's coords; Spain on Madrid's.
    // Hamburg never appears — Germany is a single stop. ISO upper-cased for the glow.
    expect(eu.tourStops).toEqual([
      { label: "Germany", lng: 13.4, lat: 52.5, iso2: "DE" },
      { label: "Spain", lng: -3.7, lat: 40.4, iso2: "ES" },
    ]);
    expect(eu.subtitle).toBe("Area tour · Regional weather");
  });

  it("airs a single-country area (UK) as one framed spotlight — no city tour", async () => {
    // The UK is one country, so there are no "top countries" to fly round — it
    // frames the whole area rather than zooming into a lone city.
    const on = await buildCandidates(
      fakeDb({
        region: {
          regionId: "uk",
          topCities: [
            { name: "London", country: "United Kingdom", cc: "gb", lng: -0.13, lat: 51.5, population: 8_900_000 },
            { name: "Birmingham", country: "United Kingdom", cc: "gb", lng: -1.9, lat: 52.48, population: 1_100_000 },
            { name: "Glasgow", country: "United Kingdom", cc: "gb", lng: -4.25, lat: 55.86, population: 600_000 },
          ],
        },
      }),
      cfg({ kinds: { region: true }, regions: ["uk"] }),
    );
    const uk = on.find((c) => c.segment.kind === "region")!.segment;
    expect(uk.tourStops).toBeUndefined();
    expect(uk.subtitle).toBe("Region spotlight · Regional weather");
  });

  it("falls back to a single spotlight when the area has no cached cities", async () => {
    const on = await buildCandidates(
      fakeDb({ region: { regionId: "europe", topCities: [] } }),
      cfg({ kinds: { region: true }, regions: ["europe"] }),
    );
    const eu = on.find((c) => c.segment.kind === "region")!.segment;
    expect(eu.tourStops).toBeUndefined();
    expect(eu.subtitle).toBe("Region spotlight · Regional weather");
  });

  it("scores a big quake above filler and frames its epicentre", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const q = pool.find((c) => c.segment.id === "quake:q1");
    expect(q).toBeTruthy();
    expect(q!.score).toBeCloseTo(40 + 6.1 * 10); // 101
    expect(q!.segment.subtitle).toBe("M6.1 · Off Japan");
    expect(q!.segment.camera.center).toEqual([140, 38]);
    const filler = pool.find((c) => c.segment.kind === "country")!;
    expect(q!.score).toBeGreaterThan(filler.score);
  });

  it("only flags a quake breaking when it's actually recent (not just unaired)", async () => {
    const recent = await buildCandidates(
      fakeDb({ quakes: [{ quakeId: "q1", mag: 6.1, place: "Off Japan", lng: 140, lat: 38, time: new Date() }] }),
      cfg(),
    );
    expect(recent.find((c) => c.segment.id === "quake:q1")!.breakIn?.reason).toBe("quake");

    const stale = await buildCandidates(
      fakeDb({
        quakes: [{ quakeId: "q1", mag: 6.1, place: "Off Japan", lng: 140, lat: 38, time: new Date(Date.now() - 60 * 60 * 1000) }],
      }),
      cfg(),
    );
    expect(stale.find((c) => c.segment.id === "quake:q1")!.breakIn).toBeUndefined();

    // No timestamp at all (shouldn't happen, but don't let it default to breaking).
    const untimed = await buildCandidates(fakeDb(), cfg());
    expect(untimed.find((c) => c.segment.id === "quake:q1")!.breakIn).toBeUndefined();
  });

  it("flags a storm breaking based on when we first saw it, not the CAP onset/effective timestamps", async () => {
    const alert = (created: string, onset?: string) => [
      {
        source: "nws",
        identifier: "a1",
        maxSeverityRank: 4,
        created,
        info: [
          {
            event: "Hurricane Warning",
            onset,
            area: [
              {
                areaDesc: "Gulf Coast",
                geometry: { type: "Polygon", coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]] },
              },
            ],
          },
        ],
      },
    ];
    const recent = await buildCandidates(fakeDb({ alerts: alert(new Date().toISOString()) }), cfg());
    const recentStorm = recent.find((c) => c.segment.kind === "storm")!;
    expect(recentStorm.breakIn?.reason).toBe("storm");
    expect(recentStorm.areaKey).toBe("country:US");

    // Ingested an hour ago — no longer breaking, even though NWS re-stamped the onset
    // just now (national met services do this on every refresh of an ongoing warning).
    const stale = await buildCandidates(
      fakeDb({
        alerts: alert(new Date(Date.now() - 60 * 60 * 1000).toISOString(), new Date().toISOString()),
      }),
      cfg(),
    );
    expect(stale.find((c) => c.segment.kind === "storm")!.breakIn).toBeUndefined();
  });

  it("adds an erupting volcano candidate as its own segment kind", async () => {
    const pool = await buildCandidates(
      fakeDb({
        volcanoes: [
          { id: "gvp:1", name: "Etna", country: "Italy", status: "erupting", lng: 15, lat: 37.7, lastDate: Date.now(), statusChangedAt: Date.now() },
        ],
      }),
      cfg(),
    );
    const v = pool.find((c) => c.segment.id === "volcano:gvp:1");
    expect(v).toBeTruthy();
    expect(v!.segment.kind).toBe("volcano");
    expect(v!.segment.title).toBe("Etna");
    expect(v!.segment.camera.center).toEqual([15, 37.7]);
    expect(v!.score).toBeCloseTo(50 + 3 * 12); // sev 3 (erupting)
  });

  it("excludes dormant volcanoes from the candidate pool", async () => {
    const pool = await buildCandidates(
      fakeDb({
        volcanoes: [
          { id: "gvp:2", name: "Fuji", status: "dormant", lng: 138.7, lat: 35.4, lastDate: Date.now(), statusChangedAt: Date.now() },
        ],
      }),
      cfg(),
    );
    expect(pool.find((c) => c.segment.id === "volcano:gvp:2")).toBeUndefined();
  });

  it("only flags a volcano breaking when its status just flipped to erupting", async () => {
    const justChanged = await buildCandidates(
      fakeDb({
        volcanoes: [
          { id: "gvp:1", name: "Etna", status: "erupting", lng: 15, lat: 37.7, lastDate: Date.now(), statusChangedAt: Date.now() },
        ],
      }),
      cfg(),
    );
    expect(justChanged.find((c) => c.segment.id === "volcano:gvp:1")!.breakIn?.reason).toBe("volcano");

    const longErupting = await buildCandidates(
      fakeDb({
        volcanoes: [
          {
            id: "gvp:1",
            name: "Etna",
            status: "erupting",
            lng: 15,
            lat: 37.7,
            lastDate: Date.now(),
            statusChangedAt: Date.now() - 7 * 60 * 60 * 1000, // outside the wider volcano breaking window
          },
        ],
      }),
      cfg(),
    );
    expect(longErupting.find((c) => c.segment.id === "volcano:gvp:1")!.breakIn).toBeUndefined();

    const unrest = await buildCandidates(
      fakeDb({
        volcanoes: [
          { id: "gvp:3", name: "Merapi", status: "unrest", lng: 110.4, lat: -7.5, lastDate: Date.now(), statusChangedAt: Date.now() },
        ],
      }),
      cfg(),
    );
    // Only a fresh transition to erupting counts as breaking — unrest never does.
    expect(unrest.find((c) => c.segment.id === "volcano:gvp:3")!.breakIn).toBeUndefined();
  });

  it("layers an operator overlayOverride onto the preset without touching other kinds", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ overlayOverrides: { quake: { showFaults: false } } }));
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.showFaults).toBe(false);
    // The preset's other quake toggles are untouched.
    expect(q.segment.patch.showCables).toBe(true);
    // Unrelated kinds don't pick up the override.
    const other = pool.find((c) => c.segment.kind === "country")!;
    expect(other.segment.patch.showFaults).toBe(false); // both default to false via LAYERS_OFF
    expect(other.segment.patch.showWind).toBe(true); // country's own preset untouched
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
    const other = pool.find((c) => c.segment.kind === "country")!;
    expect(other.segment.patch.basemap).not.toBe("night");
    expect(other.segment.patch.wind).toBeUndefined();
  });

  it("applies a kindLooks satellite look — showSatImg on + every disc's look set", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({ kindLooks: { quake: { showSatImg: true, satImgLook: "watervapour" } } }),
    );
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.showSatImg).toBe(true);
    // Discs get the look; on/opacity are left to merge from the live base (not set here).
    expect(q.segment.patch.satImgFeeds?.["meteosat-0"]?.look).toBe("watervapour");
    expect(q.segment.patch.satImgFeeds?.["goes-east"]?.look).toBe("watervapour");
    expect((q.segment.patch.satImgFeeds?.["meteosat-0"] as { on?: boolean }).on).toBeUndefined();
    // The mosaic feed is not a disc → not in the look patch.
    expect(q.segment.patch.satImgFeeds?.["global"]).toBeUndefined();
    // Other kinds untouched.
    const other = pool.find((c) => c.segment.kind === "country")!;
    expect(other.segment.patch.satImgFeeds).toBeUndefined();
  });

  it("a kindLooks satImgFeeds snapshot wins over the satImgLook shortcut", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({
        kindLooks: {
          quake: {
            satImgLook: "watervapour",
            satImgFeeds: { "goes-east": { on: true, opacity: 0.5, look: "geocolor" } },
          },
        },
      }),
    );
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    // The full per-feed snapshot overrides the single-look shortcut for feeds it names.
    expect(q.segment.patch.satImgFeeds?.["goes-east"]).toEqual({ on: true, opacity: 0.5, look: "geocolor" });
  });

  it("applies a kindLooks activeVariable override, but a segment's own computed variable still wins", async () => {
    const pool = await buildCandidates(fakeDb(), cfg({ kindLooks: { quake: { activeVariable: "humidity" } } }));
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.activeVariable).toBe("humidity");
    // storm always computes its own activeVariable ("gust") via PRESETS/extra — an
    // operator override must not clobber it.
    const storm = pool.find((c) => c.segment.kind === "storm");
    const stormCfg = cfg({ kindLooks: { storm: { activeVariable: "humidity" } } });
    const stormPool = await buildCandidates(fakeDb(), stormCfg);
    const s = stormPool.find((c) => c.segment.id === storm?.segment.id);
    expect(s?.segment.patch.activeVariable).toBe("gust");
  });

  it("applies a kindLooks auroraOpacity/magneticFieldOpacity override without touching other kinds", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({ kindLooks: { quake: { auroraOpacity: 0.4, magneticFieldOpacity: 0.6 } } }),
    );
    const q = pool.find((c) => c.segment.id === "quake:q1")!;
    expect(q.segment.patch.auroraOpacity).toBe(0.4);
    expect(q.segment.patch.magneticFieldOpacity).toBe(0.6);
    const other = pool.find((c) => c.segment.kind === "country")!;
    expect(other.segment.patch.auroraOpacity).toBeUndefined();
    expect(other.segment.patch.magneticFieldOpacity).toBeUndefined();
  });

  it("derives a storm centroid from the alert polygon", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    const storm = pool.find((c) => c.segment.kind === "storm");
    expect(storm).toBeTruthy();
    expect(storm!.segment.id).toBe("storm:nws:a1");
    // Title is the broadcast phrasebook's, not the source event ("Hurricane
    // Warning" at rank 4) — see shared/alerts/phrasebook.ts.
    expect(storm!.segment.title).toBe("Major Hurricane");
    const [lng, lat] = storm!.segment.camera.center;
    expect(lng).toBeCloseTo(-89.2, 1);
    expect(lat).toBeCloseTo(25.8, 1);
  });

  it("caps storm candidates per country so one prolific met service can't flood the pool", async () => {
    // Models the live incident that motivated the cap: Kazhydromet ran 66
    // simultaneous sev-4 warnings, so the globally severity-sorted top-40
    // came back ~90% Kazakhstan and storm rotation "stayed in one country" —
    // while every lower-severity country never became a candidate at all.
    const poly = (lng: number, lat: number) => ({
      type: "Polygon",
      coordinates: [[[lng, lat], [lng + 1, lat], [lng + 1, lat + 1], [lng, lat + 1], [lng, lat]]],
    });
    const kz = Array.from({ length: 10 }, (_, i) => ({
      source: "wmo",
      identifier: `kz-kazhydromet-en/2026/08/28/w${i}.xml`,
      maxSeverityRank: 4,
      info: [{ event: "Strong Wind", area: [{ areaDesc: `Oblast ${i}`, geometry: poly(60 + i * 2, 45) }] }],
    }));
    const hr = {
      source: "meteoalarm",
      identifier: "2.49.0.0.HR.20260829.1",
      maxSeverityRank: 3, // ranks BELOW every KZ alert — only the cap lets it in
      info: [{ event: "Wind Warning", area: [{ areaDesc: "Split", geometry: poly(16, 43) }] }],
    };
    const pool = await buildCandidates(fakeDb({ alerts: [...kz, hr] }), cfg());
    const storms = pool.filter((c) => c.segment.kind === "storm");
    expect(storms.filter((c) => c.areaKey === "country:KZ")).toHaveLength(3);
    expect(storms.some((c) => c.areaKey === "country:HR")).toBe(true);
  });

  it("picks notable aircraft and ships from the latest frame", async () => {
    const pool = await buildCandidates(fakeDb(), cfg());
    expect(pool.some((c) => c.segment.id === "flight:abc123")).toBe(true);
    expect(pool.some((c) => c.segment.id === "ship:232000001")).toBe(true);
  });

  it("excludes aircraft/ships that aren't in the notable catalog, even at cruising altitude/speed", async () => {
    const db = fakeDb({
      aircraft: [{ externalId: "xyz999", name: "RANDOM1", country: "Germany", lng: 10, lat: 50, altM: 11000 }],
      ships: [{ externalId: "999000111", name: "RandomShip", lng: 5, lat: 40, speed: 20 }],
      vehicles: [], // nothing catalogued — a plain blip no longer earns air time
    });
    const pool = await buildCandidates(db, cfg());
    expect(pool.some((c) => c.segment.kind === "flight")).toBe(false);
    expect(pool.some((c) => c.segment.kind === "ship")).toBe(false);
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
    expect(flight.score).toBe(80); // pools.vipBoost default — well above the generic 18
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
    expect(ship.score).toBe(45); // pools.notableBoost default (not a VIP)
    expect(ship.segment.title).toBe("Queen Mary 2");
    expect(ship.segment.trackInfo).toMatchObject({ label: "Queen Mary 2", notable: true });
  });

  it("stamps per-kind and per-event-level holds onto segments", async () => {
    const pool = await buildCandidates(
      fakeDb(),
      cfg({
        kindHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds, country: 20 },
        quakeHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.quakeHoldSeconds, strong: 25 },
        stormHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.stormHoldSeconds, extreme: 40 },
      }),
    );
    expect(pool.find((c) => c.segment.kind === "country")!.segment.holdMs).toBe(20_000);
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
    // Filler kinds: the intro opener, the recurring global spin, ocean spins,
    // country spotlights, and orbital shots (gated to ingested TLE groups so
    // they're never empty).
    const fillerKinds = new Set(["intro", "global", "ocean", "orbital", "country"]);
    expect(pool.every((c) => fillerKinds.has(c.segment.kind))).toBe(true);
  });

  describe("round-up summary candidates", () => {
    it("adds a round-up candidate riding the global spin (id global:<docid>, markers lit)", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const pool = await buildCandidates(db, cfg());
      const summary = pool.find((c) => c.segment.id === "global:sum1");
      expect(summary).toBeTruthy();
      expect(summary!.segment.kind).toBe("global"); // rides the global spin, not a `summary` kind
      expect(summary!.segment.summary?.narrative).toContain("Gulf Coast");
      expect(summary!.segment.summary?.period).toBe("hourly");
      // Event markers layered on so the story's quakes/alerts/volcanoes show.
      expect(summary!.segment.patch.showSeismic).toBe(true);
      expect(summary!.segment.patch.showAlerts).toBe(true);
      expect(summary!.segment.patch.showVolcanoes).toBe(true);
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
      const summary = pool.find((c) => c.segment.id === "global:sum1")!;
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
      expect(pool.some((c) => c.segment.summary != null)).toBe(false);
    });

    it("never re-airs a summary already shown this session", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const seen = new Map([["global:sum1", 1]]);
      const pool = await buildCandidates(db, cfg(), seen);
      expect(pool.some((c) => c.segment.summary != null)).toBe(false);
    });

    it("skips a stale round-up the director missed while off", async () => {
      const stale = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h old hourly round-up
      const db = fakeDb({ eventSummaries: { hourly: freshSummary({ generatedAt: stale }) } });
      const pool = await buildCandidates(db, cfg());
      expect(pool.some((c) => c.segment.summary != null)).toBe(false);
    });

    it("drops the round-up when the global spin is disabled (it rides the global kind)", async () => {
      const db = fakeDb({ eventSummaries: { hourly: freshSummary() } });
      const pool = await buildCandidates(db, cfg({ kinds: { global: false } as any }));
      expect(pool.some((c) => c.segment.summary != null)).toBe(false);
    });

    describe("summaryTourHoldMs", () => {
      it("keeps the narration-length hold (floored, ≤60s) when there are no stops", () => {
        expect(summaryTourHoldMs(0, 4000, 30_000, 20_000)).toBe(30_000); // narration wins over floor
        expect(summaryTourHoldMs(0, 4000, 10_000, 20_000)).toBe(20_000); // floor wins over short narration
        expect(summaryTourHoldMs(0, 4000, 90_000, 20_000)).toBe(60_000); // capped at 60s
      });

      it("sizes the hold to cover the whole dwell tour when there are stops", () => {
        // 3 stops × (4s flight + 40s dwell) = 132s — far past the old 60s cap.
        expect(summaryTourHoldMs(3, 4000, 30_000, 20_000)).toBe(132_000);
      });

      it("bounds the toured stops so a huge round-up can't run for many minutes", () => {
        // 20 stops clamp to tours.roundupStops (6) → 6 × 44s = 264s.
        expect(summaryTourHoldMs(20, 4000, 30_000, 20_000)).toBe(264_000);
      });

      it("never returns less than the narration floor even with stops", () => {
        expect(summaryTourHoldMs(1, 0, 100_000, 20_000)).toBe(100_000); // long narration beats 1-stop tour
      });
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
      const stops = pool.find((c) => c.segment.id === "global:sum1")!.segment.summary!.stops!;
      expect(stops).toEqual([
        { label: "Gulf Coast", subtitle: "wind · 3 events", lng: -90, lat: 29, severity: 4 },
        { label: "M6.5 — Off Japan", subtitle: undefined, lng: 140, lat: 38, severity: 4 },
      ]);
    });
  });
});

 it("includes the area catalog when Areas is enabled without favourites", async () => {
   const pool = await buildCandidates(fakeDb(), cfg({ kinds: { region: true }, regions: [] }));
   const areas = pool.filter((c) => c.segment.kind === "region");
   expect(areas.length).toBeGreaterThan(1);
   expect(areas.some((c) => c.segment.id === "region:europe")).toBe(true);
 });

/**
 * The per-channel config (rotation / pools / tours / tempo / breakIn) reaching
 * the builders. Configs go through mergeDirectorConfig, as the worker's do, so
 * the clamps and the pool-floor rule apply exactly as they will live.
 */
describe("per-channel director config", () => {
  const channel = (patch: Record<string, unknown>): DirectorConfig =>
    mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, patch as Partial<DirectorConfig>);
  const NOW = Date.now();
  const nwsAlert = (identifier: string, over: Record<string, unknown> = {}) => ({
    source: "nws",
    identifier,
    maxSeverityRank: 4,
    created: new Date(NOW).toISOString(),
    info: [
      {
        event: "Hurricane Warning",
        area: [
          {
            areaDesc: "Gulf Coast",
            geometry: { type: "Polygon", coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]] },
          },
        ],
      },
    ],
    ...over,
  });
  const quake = (over: Record<string, unknown> = {}) => ({
    quakeId: "q1",
    mag: 6.1,
    place: "Off Japan",
    lng: 140,
    lat: 38,
    depthKm: 10,
    time: new Date(NOW),
    ...over,
  });

  describe("tempo", () => {
    it("stamps the default pacing on every built segment", async () => {
      const pool = await buildCandidates(fakeDb(), channel({}));
      expect(pool.length).toBeGreaterThan(0);
      for (const c of pool) {
        expect(c.segment.tempo).toEqual({ mapStepMs: 6000, varCycleMs: 5500, depthCycleMs: 2500, stopDwellMs: 40000 });
      }
    });

    it("stamps the channel's own pacing", async () => {
      const pool = await buildCandidates(
        fakeDb(),
        channel({ tempo: { mapStepS: 10, varCycleS: 3, depthCycleS: 4 }, tours: { stopDwellS: 20 } }),
      );
      expect(pool.find((c) => c.segment.kind === "global")!.segment.tempo).toEqual({
        mapStepMs: 10000,
        varCycleMs: 3000,
        depthCycleMs: 4000,
        stopDwellMs: 20000,
      });
    });
  });

  describe("breakIn stamping", () => {
    it("stamps nothing for a reason the channel turned off", async () => {
      const pool = await buildCandidates(
        fakeDb({ quakes: [quake()], alerts: [nwsAlert("a1")] }),
        channel({ breakIn: { reasons: { quake: false } } }),
      );
      expect(pool.find((c) => c.segment.kind === "quake")!.breakIn).toBeUndefined();
      expect(pool.find((c) => c.segment.kind === "storm")!.breakIn).toEqual({ reason: "storm", at: NOW });
    });

    it("airs a quake below the break-in bar through rotation only", async () => {
      const cfg = channel({ minQuakeMag: 4.5, breakIn: { minQuakeMag: 6.5 } });
      const pool = await buildCandidates(
        fakeDb({ quakes: [quake({ quakeId: "small", mag: 5 }), quake({ quakeId: "big", mag: 7 })] }),
        cfg,
      );
      expect(pool.find((c) => c.segment.id === "quake:small")!.breakIn).toBeUndefined();
      expect(pool.find((c) => c.segment.id === "quake:big")!.breakIn?.reason).toBe("quake");
    });

    it("uses the channel's freshness window", async () => {
      const db = fakeDb({ quakes: [quake({ time: new Date(NOW - 45 * 60_000) })] });
      expect((await buildCandidates(db, channel({}))).find((c) => c.segment.kind === "quake")!.breakIn).toBeUndefined();
      const wide = await buildCandidates(db, channel({ breakIn: { windowMinutes: 60 } }));
      expect(wide.find((c) => c.segment.kind === "quake")!.breakIn?.reason).toBe("quake");
    });

    it("breaks in for a volcano flipping to unrest only when the channel opts in", async () => {
      const db = fakeDb({
        volcanoes: [{ id: "gvp:3", name: "Merapi", status: "unrest", lng: 110.4, lat: -7.5, lastDate: NOW, statusChangedAt: NOW }],
      });
      expect((await buildCandidates(db, channel({}))).find((c) => c.segment.kind === "volcano")!.breakIn).toBeUndefined();
      const optIn = await buildCandidates(db, channel({ breakIn: { volcanoMin: "unrest" } }));
      expect(optIn.find((c) => c.segment.kind === "volcano")!.breakIn).toEqual({ reason: "volcano", at: NOW });
    });

    it("keeps an alert's below-the-break-in-bar severity out of the tier", async () => {
      const pool = await buildCandidates(
        fakeDb({ alerts: [nwsAlert("sev3", { maxSeverityRank: 3 }), nwsAlert("sev4")] }),
        channel({ breakIn: { minAlertSeverity: 4 } }),
      );
      expect(pool.find((c) => c.segment.id === "storm:nws:sev3")!.breakIn).toBeUndefined();
      expect(pool.find((c) => c.segment.id === "storm:nws:sev4")!.breakIn?.reason).toBe("storm");
    });
  });

  describe("pools", () => {
    const manyUsAlerts = Array.from({ length: 8 }, (_, i) => nwsAlert(`a${i}`));

    it("caps storms per country at the channel's alertCountryCap", async () => {
      const def = await buildCandidates(fakeDb({ alerts: manyUsAlerts }), channel({}));
      expect(def.filter((c) => c.segment.kind === "storm")).toHaveLength(3);
      const wider = await buildCandidates(fakeDb({ alerts: manyUsAlerts }), channel({ pools: { alertCountryCap: 6 } }));
      expect(wider.filter((c) => c.segment.kind === "storm")).toHaveLength(6);
    });

    it("caps the whole storm pool at the channel's alertPoolCap", async () => {
      const pool = await buildCandidates(
        fakeDb({ alerts: manyUsAlerts }),
        channel({ pools: { alertPoolCap: 2, alertCountryCap: 10 } }),
      );
      expect(pool.filter((c) => c.segment.kind === "storm")).toHaveLength(2);
    });

    it("scores catalogued craft with the channel's boosts", async () => {
      const pool = await buildCandidates(
        fakeDb({
          vehicles: [
            { id: "aircraft:abc123", kind: "aircraft", code: "abc123", name: "BAW123", enabled: true, notable: true, vip: true },
            { id: "ship:232000001", kind: "ship", code: "232000001", name: "Boaty", enabled: true, notable: true },
          ],
        }),
        channel({ pools: { notableBoost: 12, vipBoost: 99 } }),
      );
      expect(pool.find((c) => c.segment.kind === "flight")!.score).toBe(99);
      expect(pool.find((c) => c.segment.kind === "ship")!.score).toBe(12);
    });
  });

  describe("tours", () => {
    const ukDossier = (cityCount: number) => ({
      gb: {
        countryId: "gb",
        iso2: "GB",
        tourCentroid: [-2.0, 53.5],
        tourFrame: { center: [-2.0, 54.0], zoom: 4.4 },
        tourCities: Array.from({ length: cityCount }, (_, i) => ({
          name: `City ${i}`,
          cc: "gb",
          lng: -i,
          lat: 50 + i * 0.1,
          population: 1_000_000 - i,
          sector: i,
        })),
      },
    });

    it("limits a country tour to countryStops, counting the establishing stop", async () => {
      const db = fakeDb({ countries: ukDossier(12) });
      const def = (await buildCandidates(db, channel({ countries: ["uk"] }))).find((c) => c.segment.id === "country:uk")!;
      expect(def.segment.tourStops).toHaveLength(8);
      const short = (await buildCandidates(db, channel({ countries: ["uk"], tours: { countryStops: 3 } }))).find(
        (c) => c.segment.id === "country:uk",
      )!;
      expect(short.segment.tourStops!.map((t) => t.label)).toEqual(["United Kingdom", "City 0", "City 1"]);
    });

    it("sizes a tour's hold from the channel's stop dwell", async () => {
      const db = fakeDb({ countries: ukDossier(2) });
      const cfg = channel({ countries: ["uk"], transitionSeconds: 4, tours: { stopDwellS: 10 } });
      const uk = (await buildCandidates(db, cfg)).find((c) => c.segment.id === "country:uk")!;
      // Establishing stop + 2 cities, each (4 s flight + 10 s dwell); above the 12 s floor.
      expect(uk.segment.holdMs).toBe(3 * 14_000);
    });

    it("limits an area tour to regionStops countries", async () => {
      const topCities = ["gb", "fr", "de", "es", "it"].map((cc, i) => ({
        name: `Capital ${cc}`,
        country: cc.toUpperCase(),
        cc,
        lng: i,
        lat: 45,
        population: 5_000_000 - i * 100_000,
      }));
      const db = fakeDb({ region: { regionId: "europe", topCities } });
      const cfg = channel({ kinds: { region: true }, regions: ["europe"], tours: { regionStops: 2 } });
      const europe = (await buildCandidates(db, cfg)).find((c) => c.segment.id === "region:europe")!;
      expect(europe.segment.tourStops!.map((t) => t.iso2)).toEqual(["GB", "FR"]);
    });

    it("frames volcanoes at the channel's zoom", async () => {
      const db = fakeDb({
        volcanoes: [{ id: "gvp:1", name: "Etna", status: "erupting", lng: 15, lat: 37.7, lastDate: NOW, statusChangedAt: NOW }],
      });
      const v = (await buildCandidates(db, channel({ tours: { volcanoZoom: 7 } }))).find((c) => c.segment.kind === "volcano")!;
      expect(v.segment.camera.zoom).toBe(7);
    });

    it("reads a round-up at the channel's words-per-minute", async () => {
      // 100 words, no stops: 170 wpm → ~35 s; 60 wpm → 100 s, capped at roundupMaxHoldS.
      const narrative = Array.from({ length: 100 }, () => "word").join(" ");
      const db = fakeDb({ eventSummaries: { hourly: freshSummary({ narrative }) } });
      const hold = async (tours: Record<string, number>) =>
        (await buildCandidates(db, channel({ tours }))).find((c) => c.segment.id === "global:sum1")!.segment.holdMs;
      expect(await hold({})).toBe(Math.round((100 / 170) * 60_000));
      expect(await hold({ roundupWordsPerMin: 60, roundupMaxHoldS: 300 })).toBe(100_000);
      expect(await hold({ roundupWordsPerMin: 60, roundupMaxHoldS: 45 })).toBe(45_000);
    });

    it("sizes a toured round-up from roundupStops and the stop dwell", () => {
      const tours = { ...DEFAULT_DIRECTOR_TOURS, roundupStops: 2, stopDwellS: 20 };
      // 5 stops clamp to 2 × (4 s flight + 20 s dwell) = 48 s.
      expect(summaryTourHoldMs(5, 4000, 10_000, 5_000, tours)).toBe(48_000);
    });
  });

  describe("kinds filter", () => {
    it("builds only the requested kinds", async () => {
      const pool = await buildCandidates(fakeDb(), channel({}), undefined, { kinds: ["quake"] });
      expect(new Set(pool.map((c) => c.segment.kind))).toEqual(new Set(["quake"]));
    });

    it("never builds a kind the channel has turned off", async () => {
      const pool = await buildCandidates(fakeDb(), channel({ kinds: { quake: false } }), undefined, {
        kinds: ["quake", "storm"],
      });
      expect(new Set(pool.map((c) => c.segment.kind))).toEqual(new Set(["storm"]));
    });
  });
});

/**
 * The single-item builders are what break-ins and commands will use to build a
 * shot for one event. They must produce exactly the candidate the pool build
 * produces for the same event, or the same event would look different
 * depending on which path aired it.
 */
describe("single-item builders", () => {
  const cfg = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {});
  const NOW = Date.now();

  it("quakeCandidate matches the pool's quake", async () => {
    const q = { quakeId: "q9", mag: 6.4, place: "Chile", lng: -71, lat: -33, depthKm: 30, time: new Date(NOW - 60_000) };
    const fromPool = (await buildCandidates(fakeDb({ quakes: [q] }), cfg)).find((c) => c.segment.id === "quake:q9")!;
    const single = quakeCandidate(q, cfg, NOW);
    expect(single).toEqual(fromPool);
    expect(single.breakIn).toEqual({ reason: "quake", at: NOW - 60_000 });
  });

  it("volcanoCandidate matches the pool's volcano", async () => {
    const v = { id: "gvp:7", name: "Etna", country: "Italy", status: "erupting", lng: 15, lat: 37.7, lastDate: NOW, statusChangedAt: NOW };
    const fromPool = (await buildCandidates(fakeDb({ volcanoes: [v] }), cfg)).find((c) => c.segment.id === "volcano:gvp:7")!;
    expect(volcanoCandidate(v as any, cfg, NOW)).toEqual(fromPool);
  });

  it("stormCandidate matches the pool's storm and reports its cap bucket", async () => {
    const a = {
      source: "nws",
      identifier: "z1",
      maxSeverityRank: 4,
      created: new Date(NOW).toISOString(),
      info: [
        {
          event: "Hurricane Warning",
          area: [{ areaDesc: "Gulf", geometry: { type: "Polygon", coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]] } }],
        },
      ],
    };
    const fromPool = (await buildCandidates(fakeDb({ alerts: [a] }), cfg)).find((c) => c.segment.id === "storm:nws:z1")!;
    const built = stormCandidate(a, cfg, NOW)!;
    expect(built.candidate).toEqual(fromPool);
    expect(built.capKey).toBe("country:US");
  });

  it("stormCandidate returns null for an alert with no polygon to frame", () => {
    expect(stormCandidate({ source: "nws", identifier: "x", info: [{ area: [{ areaDesc: "Somewhere" }] }] }, cfg, NOW)).toBeNull();
  });

  it("summaryCandidate matches the pool's round-up", async () => {
    const doc = freshSummary();
    const fromPool = (await buildCandidates(fakeDb({ eventSummaries: { hourly: doc } }), cfg)).find(
      (c) => c.segment.id === "global:sum1",
    )!;
    expect(summaryCandidate(doc as any, "hourly", "Hourly round-up", cfg)).toEqual(fromPool);
  });
});
