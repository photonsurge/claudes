/**
 * The on-air exception to the seismic live window.
 *
 * What's worth pinning here is editorial. The globe clips to 48h so a month of
 * retained USGS upserts stops smearing the plate boundaries into a solid band
 * of rings — but the clip must never reach the event the show is presenting. A
 * shot that pans to a week-old M7 and finds an empty patch of ocean is the
 * failure mode these tests exist to prevent.
 */
import { mergeOnAirQuakes } from "./seismic-overlay";
import type { Quake } from "./tracks/types";
import type { FocusTarget } from "./focus/types";

const quake = (id: string, mag: number, over: Partial<Quake> = {}): Quake => ({
  id,
  mag,
  place: `place-${id}`,
  time: Date.UTC(2026, 6, 1),
  lng: 140,
  lat: 38,
  depthKm: 10,
  ...over,
});

const targetOf = (q: Quake): FocusTarget => ({ kind: "quake", quake: q });

describe("mergeOnAirQuakes", () => {
  it("returns the live feed untouched when nothing is on air", () => {
    const live = [quake("a", 5), quake("b", 3)];
    expect(mergeOnAirQuakes(live, null, [], 2.5)).toBe(live);
  });

  it("adds the on-air quake when the window has already aged it out", () => {
    const live = [quake("recent", 4)];
    const old = quake("old-big", 7.1, { time: Date.UTC(2026, 5, 20) });
    const out = mergeOnAirQuakes(live, targetOf(old), [], 2.5);
    expect(out.map((q) => q.id)).toEqual(["recent", "old-big"]);
  });

  it("keeps the on-air quake even when it is under the operator's floor", () => {
    // The shot is ABOUT this event. A magnitude floor tuned for global clutter
    // must not blank the one ring the presenter is talking about.
    const small = quake("small-onair", 3.1);
    const out = mergeOnAirQuakes([], targetOf(small), [], 6);
    expect(out.map((q) => q.id)).toEqual(["small-onair"]);
  });

  it("brings back the on-air event's local swarm, not just its epicentre", () => {
    const live = [quake("elsewhere", 5)];
    const target = quake("main", 7, { time: Date.UTC(2026, 5, 20) });
    const swarm = [quake("after-1", 4.2), quake("after-2", 4.8)];
    const out = mergeOnAirQuakes(live, targetOf(target), swarm, 2.5);
    expect(out.map((q) => q.id).sort()).toEqual(["after-1", "after-2", "elsewhere", "main"]);
  });

  it("applies the operator's magnitude floor to the swarm", () => {
    const swarm = [quake("tiny", 2.6), quake("felt", 5.1)];
    const out = mergeOnAirQuakes([], null, swarm, 4.5);
    expect(out.map((q) => q.id)).toEqual(["felt"]);
  });

  it("never double-draws a quake already in the live feed", () => {
    const shared = quake("dup", 6);
    const out = mergeOnAirQuakes([shared], targetOf(shared), [shared], 2.5);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("dup");
  });

  it("ignores a non-quake cut but still restores its area swarm", () => {
    const storm: FocusTarget = {
      kind: "storm",
      alert: { properties: { id: "s1" } } as never,
    };
    const out = mergeOnAirQuakes([], storm, [quake("nearby", 5)], 2.5);
    expect(out.map((q) => q.id)).toEqual(["nearby"]);
  });

  it("does not mutate the live array it was handed", () => {
    const live = [quake("a", 5)];
    mergeOnAirQuakes(live, targetOf(quake("b", 6)), [quake("c", 5)], 2.5);
    expect(live.map((q) => q.id)).toEqual(["a"]);
  });
});
