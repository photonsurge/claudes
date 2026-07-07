import { eventPulse, activeCountryIso, activeRegionBbox } from "./director";
import type { DirectorState, Segment } from "@photonsurge/shared/director";

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: "tour:n-atlantic",
  kind: "tour",
  title: "North Atlantic",
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

  it("does not pulse non-event kinds (e.g. a region tour)", () => {
    expect(eventPulse(director())).toBeNull();
  });
});

describe("activeCountryIso", () => {
  it("is null when the director is idle or not on a country segment", () => {
    expect(activeCountryIso(null)).toBeNull();
    expect(activeCountryIso(director({ active: false }))).toBeNull();
    expect(activeCountryIso(director())).toBeNull(); // segment kind is "tour"
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
  it("is null when the director is idle or not on a region tour", () => {
    expect(activeRegionBbox(null)).toBeNull();
    expect(activeRegionBbox(director({ active: false }))).toBeNull();
    expect(
      activeRegionBbox(director({ segment: segment({ id: "country:portugal", kind: "country" }) })),
    ).toBeNull();
  });

  it("frames the on-air tour segment's own camera, not a catalog bbox", () => {
    const bbox = activeRegionBbox(director()); // default fixture: kind "tour", center [-30,45], zoom 3
    expect(bbox).not.toBeNull();
    const [w, s, e, n] = bbox!;
    expect(w).toBeLessThan(-30);
    expect(e).toBeGreaterThan(-30);
    expect(s).toBeLessThan(45);
    expect(n).toBeGreaterThan(45);
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
