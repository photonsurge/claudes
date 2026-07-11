import { eventPulse, activeCountryIso, activeRegionBbox, cutSteps } from "./director";
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

  it("resolves the live camera centre to a country during a round-up stop", () => {
    const roundup = director({ segment: segment({ id: "summary:1", kind: "summary" }) });
    expect(activeCountryIso(roundup, [2.5, 46.5])).toBe("FR"); // stop over France
    expect(activeCountryIso(roundup, [-40, 30])).toBeNull(); // stop over open ocean
    expect(activeCountryIso(roundup)).toBeNull(); // no live centre passed
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

  it("frames a round-up stop's live camera when it isn't over a curated country", () => {
    const roundup = director({ segment: segment({ id: "summary:1", kind: "summary" }) });
    const bbox = activeRegionBbox(roundup, { center: [-40, 30], zoom: 5 }); // mid-Atlantic
    expect(bbox).not.toBeNull();
  });

  it("defers to the country glow (returns null) when a round-up stop is over a curated country", () => {
    const roundup = director({ segment: segment({ id: "summary:1", kind: "summary" }) });
    expect(activeRegionBbox(roundup, { center: [2.5, 46.5], zoom: 5 })).toBeNull(); // France
  });
});

describe("cutSteps", () => {
  const avail: MapTypeAvailability = { variables: new Set(), aurora: false, satimg: false };

  it("holds each round-up stop instead of inheriting the summary world spin", () => {
    const roundup = segment({
      id: "summary:1",
      kind: "summary",
      // The preset spins the stop-less global backdrop — a framed stop must override it.
      patch: { autoSpin: true, spinSpeed: 2 },
      summary: {
        id: "1",
        period: "daily",
        narrative: "n",
        generatedAt: "2026-07-10T00:00:00Z",
        stops: [
          { label: "Southern Europe", lng: 12, lat: 42, severity: 2 },
          { label: "Japan", lng: 139, lat: 35, severity: 3 },
        ],
      },
    });
    const { steps } = cutSteps(roundup, avail);
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.patch.autoSpin).toBe(false); // framed stop never spins off-screen
      expect(step.patch.spinSpeed).toBe(0);
      expect(step.patch.camera).toBeDefined();
    }
  });
});
