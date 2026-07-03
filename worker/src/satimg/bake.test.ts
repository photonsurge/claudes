import { parseBakeMeta, bakeHimawari, resolvePython, type RunPythonArgs, type SatImgBakeMeta } from "./bake";

const META: SatImgBakeMeta = {
  satId: "himawari9",
  satName: "Himawari-9",
  subLon: 140.7,
  composite: "true_color",
  observationTime: "2024-01-15T02:30:00+00:00",
  bounds: [-180, -90, 180, 90],
  width: 7200,
  height: 3600,
  slot: "202401150230",
};

describe("parseBakeMeta", () => {
  it("parses the last line as JSON, ignoring earlier stray output", () => {
    const stdout = `some warning leaked to stdout\n${JSON.stringify(META)}\n`;
    expect(parseBakeMeta(stdout)).toEqual(META);
  });

  it("throws when there is no output", () => {
    expect(() => parseBakeMeta("   \n\n")).toThrow(/no output/);
  });

  it("throws when the last line is not JSON", () => {
    expect(() => parseBakeMeta("Traceback (most recent call last):")).toThrow(/not JSON/);
  });

  it("throws when required fields are missing", () => {
    expect(() => parseBakeMeta(JSON.stringify({ satId: "himawari9" }))).toThrow(/missing fields/);
  });
});

describe("resolvePython", () => {
  it("leaves a bare command for PATH lookup", () => {
    expect(resolvePython("python3")).toBe("python3");
  });

  it("leaves an absolute path untouched", () => {
    expect(resolvePython("/venv/bin/python")).toBe("/venv/bin/python");
  });

  it("resolves a relative venv path against the repo root (not cwd)", () => {
    // The ENOENT trap: yarn --cwd worker sets cwd to worker/, so a repo-root-
    // relative path must NOT resolve against cwd. Resolved path is absolute and
    // ends with the venv path regardless of where the process was launched.
    const r = resolvePython("worker/.venv-satimg/bin/python");
    expect(r.startsWith("/")).toBe(true);
    expect(r.endsWith("/worker/.venv-satimg/bin/python")).toBe(true);
    expect(r).not.toContain("/worker/worker/");
  });
});

describe("bakeHimawari", () => {
  it("builds the sidecar argv and returns the parsed meta + png bytes", async () => {
    let seen: RunPythonArgs | null = null;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // "\x89PNG"
    const res = await bakeHimawari({
      satellite: "himawari9",
      python: "/venv/bin/python",
      script: "/w/himawari.py",
      composite: "B13",
      resolution: 0.1,
      runner: async (a) => {
        seen = a;
        return JSON.stringify({ ...META, composite: "B13" });
      },
      readPng: async () => png,
    });

    expect(res.meta.composite).toBe("B13");
    expect(res.png).toBe(png);
    expect(seen!.python).toBe("/venv/bin/python");
    // argv: script --out <tmp> --satellite himawari9 --composite B13 --resolution 0.1
    expect(seen!.args[0]).toBe("/w/himawari.py");
    expect(seen!.args).toEqual(
      expect.arrayContaining(["--satellite", "himawari9", "--composite", "B13", "--resolution", "0.1"]),
    );
    const outIdx = seen!.args.indexOf("--out");
    expect(outIdx).toBeGreaterThanOrEqual(0);
    expect(seen!.args[outIdx + 1]).toMatch(/satimg-himawari9-\d+\.png$/);
  });

  it("rejects an empty PNG", async () => {
    await expect(
      bakeHimawari({
        runner: async () => JSON.stringify(META),
        readPng: async () => Buffer.alloc(0),
      }),
    ).rejects.toThrow(/empty PNG/);
  });
});
