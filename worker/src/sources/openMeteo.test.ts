// sources/openMeteo.test.ts
// Pure tests for the Open-Meteo spatial-grid nest helpers: S3 key/URL builder,
// the OM_MODELS grid-consistency (dims·res == bbox, per anisotropic axis), the
// variable-name map, and the latest-run parser. NO network, NO WASM — the live
// `.om` read is exercised out-of-band (see the ingest / manual refresh) and
// marked // VERIFY: there.

import {
  OM_MODELS,
  omModels,
  buildOmKey,
  buildOmUrl,
  buildLatestUrl,
  parseLatest,
  OPENMETEO_S3_BASE,
  type OmLatest,
} from "./openMeteo";
import { getSource } from "@photonsurge/shared/sources";

describe("Open-Meteo S3 key / URL builder (openmeteo AWS bucket)", () => {
  const run = new Date("2026-07-01T00:00:00Z");

  it("builds the f0 spatial key (run dir = reference_time, file = valid_time)", () => {
    // f0: validDate == runDate (analysis).
    const key = buildOmKey("jma_msm", run, run);
    expect(key).toBe("data_spatial/jma_msm/2026/07/01/0000Z/2026-07-01T0000.om");
  });

  it("keys the file by VALID time inside the run dir", () => {
    const valid = new Date("2026-07-01T03:00:00Z");
    const key = buildOmKey("jma_msm", run, valid);
    // run dir stays the reference_time; file stamp is the valid time.
    expect(key).toBe("data_spatial/jma_msm/2026/07/01/0000Z/2026-07-01T0300.om");
  });

  it("zero-pads month/day/hour/minute", () => {
    const r = new Date("2026-02-05T09:00:00Z");
    expect(buildOmKey("jma_msm", r, r)).toBe(
      "data_spatial/jma_msm/2026/02/05/0900Z/2026-02-05T0900.om",
    );
  });

  it("builds the full public HTTPS object URL", () => {
    expect(buildOmUrl("jma_msm", run, run)).toBe(
      `${OPENMETEO_S3_BASE}/data_spatial/jma_msm/2026/07/01/0000Z/2026-07-01T0000.om`,
    );
  });

  it("builds the latest.json pointer URL", () => {
    expect(buildLatestUrl("jma_msm")).toBe(
      `${OPENMETEO_S3_BASE}/data_spatial/jma_msm/latest.json`,
    );
  });
});

describe("OM_MODELS grid consistency (alignment rule: dims·res == bbox)", () => {
  it.each(omModels().map((m) => [m.sourceId, m] as const))(
    "%s: (dims-1)·res == bbox span per axis, exactly",
    (_id, model) => {
      const [w, s, e, n] = model.bbox;
      // lon axis: (nx-1)·lonRes == E-W ; lat axis: (ny-1)·latRes == N-S.
      expect((model.dims.width - 1) * model.res.lon).toBeCloseTo(e - w, 6);
      expect((model.dims.height - 1) * model.res.lat).toBeCloseTo(n - s, 6);
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
    },
  );

  it("jma-msm has the VERIFIED grid (dims 481×505, bbox [120,22.4,150,47.6], res lon 0.0625 / lat 0.05)", () => {
    const m = OM_MODELS["jma-msm"];
    expect(m.omModel).toBe("jma_msm");
    expect(m.dims).toEqual({ width: 481, height: 505 });
    expect(m.bbox).toEqual([120.0, 22.4, 150.0, 47.6]);
    expect(m.res.lon).toBeCloseTo(0.0625, 6);
    expect(m.res.lat).toBeCloseTo(0.05, 6);
    // Explicit alignment: exactly hits the eastern / northern edge.
    expect(120.0 + (481 - 1) * m.res.lon).toBeCloseTo(150.0, 6);
    expect(22.4 + (505 - 1) * m.res.lat).toBeCloseTo(47.6, 6);
  });

  it("each OM_MODELS entry matches its SourceDescriptor bbox + dims", () => {
    for (const m of omModels()) {
      const s = getSource(m.sourceId);
      expect(s).toBeDefined();
      expect(s!.bbox).toEqual(m.bbox);
      expect(s!.dims).toEqual(m.dims);
      // descriptor scalar res = the finer (lat) axis.
      expect(s!.resolutionDeg).toBeCloseTo(Math.min(m.res.lon, m.res.lat), 6);
    }
  });
});

describe("variable-name map (Open-Meteo → app)", () => {
  it("jma-msm maps temp/humidity scalars + wind u/v (earth-relative)", () => {
    const vm = OM_MODELS["jma-msm"].varMap;
    expect(vm.scalars.temp).toBe("temperature_2m");
    expect(vm.scalars.humidity).toBe("relative_humidity_2m");
    expect(vm.windUV).toEqual({ u: "wind_u_component_10m", v: "wind_v_component_10m" });
    // gust is intentionally NOT mapped (wind_gusts_10m absent from jma_msm) — the
    // ingest skips unmapped/missing children without failing the run.
    expect(vm.scalars.gust).toBeUndefined();
  });

  it("every mapped app-variable exists on the SourceDescriptor's variables list", () => {
    for (const m of omModels()) {
      const s = getSource(m.sourceId)!;
      for (const appId of Object.keys(m.varMap.scalars)) {
        expect(s.variables).toContain(appId);
      }
      if (m.varMap.windUV) expect(s.variables).toContain("wind");
    }
  });
});

describe("latest-run parser (data_spatial/<model>/latest.json)", () => {
  const base: OmLatest = {
    completed: true,
    reference_time: "2026-07-01T00:00:00Z",
    valid_times: ["2026-07-01T00:00Z", "2026-07-01T01:00Z"],
    variables: ["temperature_2m", "wind_u_component_10m", "wind_v_component_10m"],
  };

  it("parses reference_time → f0 run (validDate == runDate)", () => {
    const run = parseLatest(base);
    expect(run.runDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(run.validDate.getTime()).toBe(run.runDate.getTime());
    expect(run.variables).toContain("temperature_2m");
  });

  it("throws on a not-completed run", () => {
    expect(() => parseLatest({ ...base, completed: false })).toThrow(/not completed/);
  });

  it("throws on missing/invalid reference_time", () => {
    expect(() => parseLatest({ ...base, reference_time: undefined as unknown as string })).toThrow(/reference_time/);
    expect(() => parseLatest({ ...base, reference_time: "not-a-date" })).toThrow(/bad reference_time/);
  });
});
