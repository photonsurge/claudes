// Guard: every GFS-bound map-type variable must resolve to REAL GRIB messages in
// a live GFS `.idx`. This is the test that would have caught map types silently
// going blank — a level-token typo (→ 0 messages) or an instant-vs-time-average
// double (→ 2 messages for one field) both fail here instead of in production.
//
// The fixture is a real captured `gfs.t12z.pgrb2.0p25.f003.idx` (a 3-hour
// forecast step, so it carries the fcst/ave duplicates the analysis step lacks).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { parseGfsIdx, matchIdxEntries, selectIdxRanges } from "./gfs";

const entries = parseGfsIdx(
  readFileSync(join(__dirname, "__fixtures__", "gfs.t12z.pgrb2.0p25.f003.idx"), "utf8"),
);

// The variables baked from the PRIMARY pgrb2 file (this fixture). "wave" uses its
// own gfswave `.idx`; "pgrb2b" (e.g. DUVB UV) lives in the secondary parameter
// file, which this primary-file fixture does not contain — both are excluded here.
const atmosVars = Object.values(VARIABLE_REGISTRY).filter(
  (v) => v.gfs && v.gfs.product !== "wave" && v.gfs.product !== "pgrb2b",
);

/** Mirror bakeVariableStep: a masked scalar also pulls LAND@surface. */
function requestFor(v: (typeof atmosVars)[number]) {
  const gfs = v.gfs!;
  const masked = v.encoding === "scalar" && !!gfs.mask;
  return {
    vars: masked ? [...gfs.vars, "LAND"] : gfs.vars,
    levels: masked ? [...gfs.levels, "surface"] : gfs.levels,
    // one message per requested var (+1 for the LAND mask when masked).
    expected: gfs.vars.length + (masked ? 1 : 0),
  };
}

describe("GFS variable registry ⟷ live .idx resolution", () => {
  it("has a real fixture and variables to check", () => {
    expect(entries.length).toBeGreaterThan(300);
    expect(atmosVars.length).toBeGreaterThanOrEqual(10);
  });

  it.each(atmosVars.map((v) => [v.id, v] as const))(
    "%s resolves to exactly its expected message(s) — never 0 (typo/missing) nor doubled (instant+avg)",
    (_id, v) => {
      const { vars, levels, expected } = requestFor(v);

      const matched = matchIdxEntries(entries, vars, levels);
      expect(matched.map((m) => `${m.varName}:${m.level}`)).toHaveLength(expected);

      const ranges = selectIdxRanges(entries, vars, levels);
      expect(ranges.length).toBeGreaterThan(0);
      for (const r of ranges) {
        expect(r.start).toBeGreaterThanOrEqual(0);
        if (r.end !== undefined) expect(r.end).toBeGreaterThan(r.start);
      }
    },
  );

  it("rain (PRATE) and cloud (TCDC) select ONE message despite GFS emitting instant + time-average copies", () => {
    expect(matchIdxEntries(entries, ["PRATE"], ["surface"])).toHaveLength(1);
    expect(matchIdxEntries(entries, ["TCDC"], ["entire_atmosphere"])).toHaveLength(1);
  });
});
