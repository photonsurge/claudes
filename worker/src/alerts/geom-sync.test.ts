import { interleaveByCountry } from "./geom-sync";
import type { EdrFeature } from "./meteogate";

const feat = (cc: string, n: number): EdrFeature =>
  ({ alertId: `${cc}-${n}`, countryCode: cc, bbox: null, indexInfo: 0, indexArea: 0 }) as EdrFeature;

describe("interleaveByCountry", () => {
  it("spreads a budget across countries instead of draining the first", () => {
    // The bug this exists for: Austria offered 450 alerts and sorted first, so a
    // sliced budget resolved Austria only — Poland was never reached.
    const m = new Map([
      ["AT", Array.from({ length: 5 }, (_, i) => feat("AT", i))],
      ["PL", Array.from({ length: 5 }, (_, i) => feat("PL", i))],
    ]);

    const first4 = interleaveByCountry(m).slice(0, 4);

    expect(first4.map((f) => f.countryCode)).toEqual(["AT", "PL", "AT", "PL"]);
  });

  it("keeps going once a short country runs out", () => {
    const m = new Map([
      ["AT", [feat("AT", 0)]],
      ["PL", [feat("PL", 0), feat("PL", 1), feat("PL", 2)]],
    ]);

    expect(interleaveByCountry(m).map((f) => f.alertId)).toEqual(["AT-0", "PL-0", "PL-1", "PL-2"]);
  });

  it("loses nothing — every alert still appears exactly once", () => {
    const m = new Map([
      ["AT", Array.from({ length: 7 }, (_, i) => feat("AT", i))],
      ["PL", Array.from({ length: 3 }, (_, i) => feat("PL", i))],
      ["UK", Array.from({ length: 5 }, (_, i) => feat("UK", i))],
    ]);

    const out = interleaveByCountry(m);

    expect(out).toHaveLength(15);
    expect(new Set(out.map((f) => f.alertId)).size).toBe(15);
  });

  it("handles empty input", () => {
    expect(interleaveByCountry(new Map())).toEqual([]);
    expect(interleaveByCountry(new Map([["AT", []]]))).toEqual([]);
  });
});
