import { getSource } from "@photonsurge/shared/sources";
import { RTOFS_REGIONAL_SOURCES } from "@photonsurge/shared/sources.rtofsRegional";

import {
  buildRtofsRegionalUrl,
  padRegionalHour,
  RTOFS_REGIONAL_TOKENS,
  RTOFS_REGIONAL_VAR_MATCH,
  RTOFS_WINDOWS,
  rtofsWindow,
} from "./rtofsRegional";

describe("buildRtofsRegionalUrl (regional GRIB2 window)", () => {
  it("builds the NOMADS *_std.grb2 window URL (nowcast rollup, t00z)", () => {
    const url = buildRtofsRegionalUrl({ date: "20260701", token: "west_atl" });
    expect(url).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.20260701/rtofs_glo.t00z.n024_west_atl_std.grb2",
    );
  });

  it("supports forecast kind and pads the rollup hour", () => {
    expect(buildRtofsRegionalUrl({ date: "20260701", token: "alaska", kind: "f" })).toContain(
      "rtofs_glo.t00z.f024_alaska_std.grb2",
    );
    expect(buildRtofsRegionalUrl({ date: "20260701", token: "guam", hour: 0 })).toContain(
      "rtofs_glo.t00z.n000_guam_std.grb2",
    );
    expect(padRegionalHour(24)).toBe("024");
    expect(padRegionalHour(6)).toBe("006");
  });

  it("always targets the single 00z cycle for every window token", () => {
    for (const token of Object.values(RTOFS_REGIONAL_TOKENS)) {
      const url = buildRtofsRegionalUrl({ date: "20260701", token });
      expect(url).toContain(".t00z.");
      expect(url).toContain(`_${token}_std.grb2`);
    }
  });
});

describe("RTOFS regional GRIB2 -match tokens", () => {
  it("uses WTMP/UOGRD/VOGRD/SALTY for sst/current/salinity", () => {
    expect(RTOFS_REGIONAL_VAR_MATCH.sst.match).toEqual([":WTMP:"]);
    expect(RTOFS_REGIONAL_VAR_MATCH.current.match).toEqual([":UOGRD:", ":VOGRD:"]);
    expect(RTOFS_REGIONAL_VAR_MATCH.salinity.match).toEqual([":SALTY:"]);
    expect(RTOFS_REGIONAL_VAR_MATCH.current.encoding).toBe("uv");
    expect(RTOFS_REGIONAL_VAR_MATCH.sst.encoding).toBe("scalar");
  });
});

describe("RTOFS_WINDOWS table (token ↔ descriptor join)", () => {
  const globalRtofs = getSource("rtofs")!;

  it("has one entry per descriptor token and no orphans", () => {
    const tokenIds = Object.keys(RTOFS_REGIONAL_TOKENS).sort();
    const winIds = RTOFS_WINDOWS.map((w) => w.sourceId).sort();
    const descIds = Object.keys(RTOFS_REGIONAL_SOURCES).sort();
    expect(winIds).toEqual(tokenIds);
    // Every token id is a registered nest descriptor and vice-versa.
    expect(descIds).toEqual(tokenIds);
  });

  it("window ids are unique and prefixed rtofs-", () => {
    const ids = RTOFS_WINDOWS.map((w) => w.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("rtofs-")).toBe(true);
  });

  it("NOMADS tokens are unique", () => {
    const tokens = RTOFS_WINDOWS.map((w) => w.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("rtofsWindow resolves known/unknown ids", () => {
    expect(rtofsWindow("rtofs-westatl")?.token).toBe("west_atl");
    expect(rtofsWindow("nope")).toBeUndefined();
  });

  describe.each(RTOFS_WINDOWS)("$sourceId geometry", (win) => {
    it("has a well-formed bbox (W<E monotonic, S<N, W wrapped)", () => {
      const [w, s, e, n] = win.bbox;
      // West edge is wrapped into −180..180; East extends by the ascending span and
      // MAY exceed 180 when the window crosses the antimeridian (periodic globe).
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      expect(w).toBeGreaterThanOrEqual(-180);
      expect(w).toBeLessThan(180);
      expect(e - w).toBeLessThan(360); // a sub-global span, never wraps the planet
      expect(s).toBeGreaterThanOrEqual(-90);
      expect(n).toBeLessThanOrEqual(90);
    });

    it("is a sub-global, zoom-gated window that outranks the global base", () => {
      const src = getSource(win.sourceId)!;
      const [w, s, e, n] = win.bbox;
      const spansGlobe = w <= -180 && e >= 180 && s <= -90 && n >= 90;
      expect(spansGlobe).toBe(false);
      // Outranks the global base so the native window wins inside its bbox.
      expect(src.priority).toBeGreaterThan(globalRtofs.priority);
      // Zoom-gated: declares minZoom so the client treats it as a nest.
      expect(src.minZoom).toBeGreaterThan(0);
    });

    it("only ENABLED windows are finer-or-equal to the global base (coarse ones disabled)", () => {
      const src = getSource(win.sourceId)!;
      if (src.enabled === false) {
        // Disabled precisely BECAUSE they are coarser than the 1/12° base.
        expect(src.resolutionDeg).toBeGreaterThan(globalRtofs.resolutionDeg + 1e-9);
      } else {
        expect(src.resolutionDeg).toBeLessThanOrEqual(globalRtofs.resolutionDeg + 1e-9);
      }
    });

    it("declares real measured grid dims (nx,ny > 1)", () => {
      expect(win.dims.width).toBeGreaterThan(1);
      expect(win.dims.height).toBeGreaterThan(1);
      expect(Number.isInteger(win.dims.width)).toBe(true);
      expect(Number.isInteger(win.dims.height)).toBe(true);
    });

    it("only supplies ocean variables we have match tokens for", () => {
      for (const v of win.variables) {
        expect(["sst", "current", "salinity"]).toContain(v);
        expect(RTOFS_REGIONAL_VAR_MATCH[v]).toBeDefined();
      }
      expect(win.variables.length).toBeGreaterThan(0);
    });
  });
});
