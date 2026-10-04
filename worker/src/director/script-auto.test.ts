// `auto` scope (docs/short-video-plan.md §8): the busiest place by summed event score.
import { autoCandidates, autoScoringKinds, pickAutoPlace, planetActivity, type AutoCandidate } from "./script-auto";

const cand = (id: string, bbox: [number, number, number, number], members: string[] = [], type: "country" | "area" = "country"): AutoCandidate => ({
  scope: { type, id },
  name: id,
  bbox,
  members: new Set(members),
});

describe("pickAutoPlace", () => {
  const japan = cand("japan", [129, 31, 146, 46], ["jp"]);
  const chile = cand("chile", [-75.7, -55.9, -66.4, -17.5], ["cl"]);
  const usa = cand("usa", [-125, 24, -66, 49.5], ["us"]);

  it("sums alerts by country code and quakes/volcanoes by point, and takes the highest", () => {
    const items = [
      { score: 98, cc: "us" }, // one severe US alert
      { score: 60, point: [140, 36] as [number, number] }, // two Japan quakes
      { score: 55, point: [142, 38] as [number, number] },
      { score: 70, point: [-70, -30] as [number, number] }, // a Chilean volcano
    ];
    expect(pickAutoPlace(items, [japan, chile, usa], new Set())).toEqual({ candidate: japan, score: 115 });
  });

  it("skips the excluded places (this schedule's last few)", () => {
    const items = [{ score: 115, cc: "jp" }, { score: 98, cc: "us" }];
    expect(pickAutoPlace(items, [japan, chile, usa], new Set(["japan"]))?.candidate.scope.id).toBe("usa");
  });

  it("is null when nothing is active outside the excluded places; ties keep catalog order", () => {
    expect(pickAutoPlace([{ score: 50, cc: "jp" }], [japan, chile], new Set(["japan"]))).toBeNull();
    expect(pickAutoPlace([], [japan], new Set())).toBeNull();
    expect(pickAutoPlace([{ score: 50, cc: "jp" }, { score: 50, cc: "cl" }], [chile, japan], new Set())?.candidate.scope.id).toBe("chile");
  });

  it("handles a box that wraps the antimeridian", () => {
    const pacific = cand("pacific", [170, -50, -170, 10], [], "area");
    expect(pickAutoPlace([{ score: 40, point: [-175, -20] }], [pacific], new Set())?.score).toBe(40);
  });
});

describe("autoScoringKinds", () => {
  it("scores by the video's switches, or by everything for a round-up-only video", () => {
    expect(autoScoringKinds({ alerts: true, quakes: false, volcanoes: false })).toEqual({ alerts: true, quakes: false, volcanoes: false });
    expect(autoScoringKinds({ alerts: false, quakes: false, volcanoes: false })).toEqual({ alerts: true, quakes: true, volcanoes: true });
  });
});

describe("planetActivity + autoCandidates", () => {
  it("reads alerts without polygons, by country; drops geocode-only ones", async () => {
    const db: any = {
      alerts: {
        list: jest.fn(async () => [
          { source: "nws", identifier: "a1", maxSeverityRank: 3, info: [{ area: [{ geometry: { type: "Polygon" } }] }] },
          { source: "nws", identifier: "a2", maxSeverityRank: 4, info: [{ area: [{}] }] }, // geocode-only
        ]),
      },
    };
    const items = await planetActivity(db, { minAlertSeverity: 2 } as any, { alerts: true, quakes: false, volcanoes: false }, Date.now());
    expect(db.alerts.list).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: true, omitCoordinates: true }));
    expect(items).toEqual([{ score: 50 + 3 * 12, cc: "us" }]);
  });

  it("countries come from the curated shots; areas take continent members from the catalog", async () => {
    const db: any = { countries: { list: jest.fn(async () => [{ iso2: "FR", continent: "Europe" }, { iso2: "JP", continent: "Asia" }]) } };
    const countries = await autoCandidates(db, "country");
    expect(countries.find((c) => c.scope.id === "japan")?.members).toEqual(new Set(["jp"]));
    const areas = await autoCandidates(db, "area");
    const europe = areas.find((c) => c.scope.id === "europe");
    expect(europe?.scope).toEqual({ type: "area", id: "europe" });
    expect(europe?.members.has("fr")).toBe(true);
    expect(europe?.members.has("jp")).toBe(false);
  });
});
