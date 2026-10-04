import { eventPulse, activeCountryIso, activeRegionBbox, cutMapTypeIds, cutSteps } from "./director";
import type { DirectorState, Segment } from "@photonsurge/shared/director";
import type { MapTypeAvailability } from "./director";

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: "global:world",
  kind: "global",
  title: "Global Weather",
  camera: { center: [-30, 45], zoom: 3 },
  patch: {},
  holdMs: 10_000,
  ...over,
});

/** The go-round-a-place camera stops an Areas (region) shot carries. Their
 *  presence is what `activeCountryIso`/`activeRegionBbox`/`cutSteps` key the
 *  tour + glow on — and only on non-spin cuts (a world spin never tours). */
const tourStops = (): NonNullable<Segment["tourStops"]> => [
  { label: "Paris", lng: 2.35, lat: 48.85 },
  { label: "Tokyo", lng: 139.7, lat: 35.68 },
];

/** A round-up narrative payload — a world spin may carry it as on-air graphics,
 *  but it must never drive the camera (no tour, no country glow). */
const roundupPayload = (): NonNullable<Segment["summary"]> => ({
  id: "1",
  period: "daily",
  narrative: "n",
  generatedAt: "2026-07-10T00:00:00Z",
});

const director = (over: Partial<DirectorState> = {}): DirectorState => ({
  sceneId: "default",
  seq: 1,
  active: true,
  segment: segment(),
  startedAt: 0,
  endsAt: 10_000,
  upNext: [],
  ...over,
});

describe("eventPulse", () => {
  it("holds the pulse during a breaking cut's INCOMING pre-roll and fires it on lock", () => {
    const T = Date.UTC(2026, 9, 4, 12);
    const d = director({
      segment: segment({ id: "quake:x", kind: "quake", camera: { center: [140, 38], zoom: 5 }, patch: { spinEpoch: T }, incomingMs: 4000 }),
    });
    expect(eventPulse(d, T + 1000)).toBeNull();
    expect(eventPulse(d, T + 4000)).toEqual([140, 38]);
  });

  it("is null when the director is idle or has no segment", () => {
    expect(eventPulse(null)).toBeNull();
    expect(eventPulse(director({ active: false }))).toBeNull();
    expect(eventPulse(director({ segment: null }))).toBeNull();
  });

  it("pulses storm/quake kinds at the segment's camera centre", () => {
    expect(eventPulse(director({ segment: segment({ kind: "storm", camera: { center: [10, 20], zoom: 4 } }) }))).toEqual([10, 20]);
    expect(eventPulse(director({ segment: segment({ kind: "quake", id: "quake:us1", camera: { center: [1, 2], zoom: 5 } }) }))).toEqual([1, 2]);
  });

  it("does not pulse non-event kinds (e.g. a global spin)", () => {
    expect(eventPulse(director())).toBeNull();
  });
});

describe("activeCountryIso", () => {
  it("is null when the director is idle or not on a country segment", () => {
    expect(activeCountryIso(null)).toBeNull();
    expect(activeCountryIso(director({ active: false }))).toBeNull();
    expect(activeCountryIso(director())).toBeNull(); // segment kind is "global"
  });

  it("resolves the catalog ISO2 from a 'country:<id>' segment id", () => {
    const iso = activeCountryIso(
      director({ segment: segment({ id: "country:portugal", kind: "country", title: "Portugal" }) }),
    );
    expect(iso).toBe("PT");
  });

  it("is null for an unknown country id (stale config)", () => {
    const iso = activeCountryIso(
      director({ segment: segment({ id: "country:atlantis", kind: "country", title: "Atlantis" }) }),
    );
    expect(iso).toBeNull();
  });

  it("resolves the live camera centre to a country during an Areas tour stop", () => {
    const tour = director({ segment: segment({ id: "region:europe", kind: "region", tourStops: tourStops() }) });
    expect(activeCountryIso(tour, [2.5, 46.5])).toBe("FR"); // stop over France
    expect(activeCountryIso(tour, [-40, 30])).toBeNull(); // stop over open ocean
    expect(activeCountryIso(tour)).toBeNull(); // no live centre passed
  });

  it("prefers the tour stop's own ISO — glows countries outside the curated catalog", () => {
    // Nigeria isn't in the curated `country` catalog, so the point lookup can't
    // glow it — the worker-tagged stop ISO must (exact stop-coord match).
    const tour = director({
      segment: segment({
        id: "region:africa",
        kind: "region",
        tourStops: [{ label: "Lagos", subtitle: "Nigeria", lng: 3.4, lat: 6.5, iso2: "NG" }],
      }),
    });
    expect(activeCountryIso(tour, [3.4, 6.5])).toBe("NG");
  });

  it("never glows a country for a world spin, even when it carries a round-up", () => {
    // A round-up rides a `global` spin as narrative graphics only — the spin
    // just shows maps off, so it never glows the country under the live camera.
    const spin = director({ segment: segment({ id: "global:1", kind: "global", summary: roundupPayload() }) });
    expect(activeCountryIso(spin, [2.5, 46.5])).toBeNull(); // over France, but it's a spin
  });
});

describe("activeRegionBbox", () => {
  it("is null when the director is idle or not on a wide framed shot", () => {
    expect(activeRegionBbox(null)).toBeNull();
    expect(activeRegionBbox(director({ active: false }))).toBeNull();
    expect(
      activeRegionBbox(director({ segment: segment({ id: "country:portugal", kind: "country" }) })),
    ).toBeNull();
  });

  it("frames an Areas tour stop's live camera when it isn't over a curated country", () => {
    const tour = director({ segment: segment({ id: "region:atlantic", kind: "region", tourStops: tourStops() }) });
    const bbox = activeRegionBbox(tour, { center: [-40, 30], zoom: 5 }); // mid-Atlantic
    expect(bbox).not.toBeNull();
  });

  it("defers to the country glow (returns null) when an Areas tour stop is over a curated country", () => {
    const tour = director({ segment: segment({ id: "region:europe", kind: "region", tourStops: tourStops() }) });
    expect(activeRegionBbox(tour, { center: [2.5, 46.5], zoom: 5 })).toBeNull(); // France
  });

  it("defers to the stop's own ISO glow (returns null) even outside the curated catalog", () => {
    const tour = director({
      segment: segment({
        id: "region:africa",
        kind: "region",
        tourStops: [{ label: "Lagos", subtitle: "Nigeria", lng: 3.4, lat: 6.5, iso2: "NG" }],
      }),
    });
    expect(activeRegionBbox(tour, { center: [3.4, 6.5], zoom: 5 })).toBeNull();
  });

  it("never frames a world spin, even when it carries a round-up", () => {
    const spin = director({ segment: segment({ id: "global:1", kind: "global", summary: roundupPayload() }) });
    expect(activeRegionBbox(spin, { center: [-40, 30], zoom: 5 })).toBeNull(); // a spin just shows maps
  });
});

describe("cutSteps", () => {
  const avail: MapTypeAvailability = { variables: new Set(), aurora: false, satimg: false };

  const tourStops = (): NonNullable<Segment["tourStops"]> => [
    { label: "Southern Europe", lng: 12, lat: 42, severity: 2 },
    { label: "Japan", lng: 139, lat: 35, severity: 3 },
  ];
  const roundupStops = (): NonNullable<Segment["summary"]> => ({
    id: "1",
    period: "daily",
    narrative: "n",
    generatedAt: "2026-07-10T00:00:00Z",
    stops: tourStops(),
  });

  it("holds each Areas tour stop (the go-round-a-place camera model)", () => {
    const tour = segment({
      id: "region:europe",
      kind: "region",
      // A backdrop spin would drift a framed stop off-screen — each stop must override it.
      patch: { autoSpin: true, spinSpeed: 2 },
      tourStops: tourStops(),
    });
    const { steps } = cutSteps(tour, avail);
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.patch.autoSpin).toBe(false); // framed stop never spins off-screen
      expect(step.patch.spinSpeed).toBe(0);
      expect(step.patch.camera).toBeDefined();
    }
  });

  it("captions each Areas tour stop as `focus` (the reticle), not a title relabel", () => {
    // A tour step marks its city caption `focus` so useDirectorCut routes it to the
    // centre reticle and leaves the shot's own (area) title intact.
    const tour = segment({ id: "region:europe", kind: "region", tourStops: tourStops() });
    const { steps } = cutSteps(tour, avail);
    expect(steps.every((s) => s.focus === true)).toBe(true);
    expect(steps[0].label?.title).toBe("Southern Europe");
  });

  it("dwells the full per-stop package by default (the live channel)", () => {
    const tour = segment({ id: "region:europe", kind: "region", patch: { cutTransitionMs: 3000 }, tourStops: tourStops() });
    expect(cutSteps(tour, avail).periodMs).toBe(3000 + 40_000);
  });

  it("paces the tour off the segment's own tourDwellMs (a scripted clip)", () => {
    const tour = segment({
      id: "country:japan",
      kind: "country",
      patch: { cutTransitionMs: 3000 },
      tourStops: tourStops(),
      tourDwellMs: 9000,
    });
    expect(cutSteps(tour, avail).periodMs).toBe(3000 + 9000);
  });

  it("ignores tourDwellMs on a world spin — it never tours", () => {
    const spin = segment({ id: "global:1", kind: "global", summary: roundupStops() });
    const paced = { ...spin, tourDwellMs: 9000 };
    expect(cutSteps(paced, avail).periodMs).toBe(cutSteps(spin, avail).periodMs);
  });

  it("uses the channel's stop dwell when the segment carries none; a clip's own dwell wins", () => {
    const tempo = { mapStepMs: 6000, varCycleMs: 5500, depthCycleMs: 2500, stopDwellMs: 20_000 };
    const tour = segment({ id: "region:europe", kind: "region", patch: { cutTransitionMs: 3000 }, tourStops: tourStops(), tempo });
    expect(cutSteps(tour, avail).periodMs).toBe(3000 + 20_000);
    expect(cutSteps({ ...tour, tourDwellMs: 9000 }, avail).periodMs).toBe(3000 + 9000);
  });

  it("parks a viewer's :mode spin on the one look they asked for", () => {
    const spin = segment({ id: "global:world", kind: "global", mapTypes: ["temp"] });
    const live = { ...avail, variables: new Set(["temp", "cloud"]) };
    const { steps } = cutSteps(spin, live, cutMapTypeIds(spin, { mapTypes: { global: ["temp", "cloud"] } }));
    expect(steps).toHaveLength(1);
    expect(steps[0].patch.activeVariable).toBe("temp");
  });

  it("never tours a world spin — it shows maps off even when it carries stops", () => {
    // A round-up rides a `global` spin as narrative graphics only; the camera
    // keeps spinning through the map-type cycle rather than flying to the stops.
    const spin = segment({ id: "global:1", kind: "global", summary: roundupStops() });
    const { steps } = cutSteps(spin, avail);
    expect(steps.length).toBeGreaterThan(2); // the globalMapTour cycle, not the 2 stops
    expect(steps.every((s) => s.patch.camera === undefined)).toBe(true); // no fly-to
    // A global map-type step relabels the card (title), it is never a `focus` step.
    expect(steps.every((s) => !s.focus)).toBe(true);
  });

  describe("pacing (Segment.tempo)", () => {
    const tempo = { mapStepMs: 9000, varCycleMs: 3000, depthCycleMs: 1500, stopDwellMs: 12000 };

    it("falls back to the built-in dwell when the cut carries no tempo (older worker)", () => {
      expect(cutSteps(segment({ id: "global:world", kind: "global" }), avail).periodMs).toBe(6000);
      expect(cutSteps(segment({ id: "country:uk", kind: "country" }), avail).periodMs).toBe(5500);
      expect(cutSteps(segment({ id: "ocean:p", kind: "ocean", depthCycle: true }), avail).periodMs).toBe(2500);
      const tour = segment({ id: "region:europe", kind: "region", tourStops: tourStops(), patch: { cutTransitionMs: 4000 } });
      expect(cutSteps(tour, avail).periodMs).toBe(4000 + 40000);
    });

    it("paces a map-type tour from the channel's map step", () => {
      expect(cutSteps(segment({ id: "global:world", kind: "global", tempo }), avail).periodMs).toBe(9000);
    });

    it("paces a variable cycle from the channel's var cycle", () => {
      expect(cutSteps(segment({ id: "country:uk", kind: "country", tempo }), avail).periodMs).toBe(3000);
    });

    it("paces a depth cycle from the channel's depth cycle", () => {
      expect(cutSteps(segment({ id: "ocean:p", kind: "ocean", depthCycle: true, tempo }), avail).periodMs).toBe(1500);
    });

    it("parks on each tour stop for the flight plus the channel's stop dwell", () => {
      const tour = segment({ id: "region:europe", kind: "region", tourStops: tourStops(), tempo, patch: { cutTransitionMs: 2500 } });
      expect(cutSteps(tour, avail).periodMs).toBe(2500 + 12000);
    });

    it("leaves a storm's hazard plan cadence alone", () => {
      const withTempo = cutSteps(segment({ id: "storm:x", kind: "storm", tempo }), avail).periodMs;
      const without = cutSteps(segment({ id: "storm:x", kind: "storm" }), avail).periodMs;
      expect(withTempo).toBe(without);
    });
  });
});

describe("cutMapTypeIds", () => {
  const cfg = { mapTypes: { global: ["temp", "cloud"] } };

  it("prefers the cut's own looks (a viewer's :mode request)", () => {
    expect(cutMapTypeIds({ kind: "global", mapTypes: ["aurora"] }, cfg)).toEqual(["aurora"]);
  });

  it("falls back to the channel's looks for the kind", () => {
    expect(cutMapTypeIds({ kind: "global" }, cfg)).toEqual(["temp", "cloud"]);
    expect(cutMapTypeIds({ kind: "global", mapTypes: [] }, cfg)).toEqual(["temp", "cloud"]);
    expect(cutMapTypeIds({ kind: "ocean" }, cfg)).toBeUndefined();
  });

  it("is undefined with nothing on air", () => {
    expect(cutMapTypeIds(null, cfg)).toBeUndefined();
  });
});
