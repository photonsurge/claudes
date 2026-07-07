import type { WeatherManifest } from "@photonsurge/shared/manifest";

jest.mock("./textures", () => ({
  loadTexture: jest.fn(),
}));

import { loadTexture } from "./textures";
import { getVariable } from "@photonsurge/shared/variables";
import { sampleDepthProfile } from "./depthProfile";

const mockLoadTexture = loadTexture as jest.MockedFunction<typeof loadTexture>;

/** A flat 2x2 texture (uniform byte in every corner) so any in-bounds point
 *  bilinear-samples the same value, regardless of exact lat/lng. */
function flatTexture(byte: number, alpha = 255) {
  const px = [byte, byte, byte, alpha];
  return { data: Uint8Array.from([...px, ...px, ...px, ...px]), width: 2, height: 2 };
}

function makeManifest(overrides: Partial<WeatherManifest["variables"]> = {}): WeatherManifest {
  const base = (id: string, byte: number): WeatherManifest["variables"][string] => ({
    encoding: "scalar",
    units: "°C",
    imageUnscale: [-5, 40],
    bbox: [-180, -80, 180, 90],
    files: { "0": `https://tex/${id}` },
  });
  return {
    model: "rtofs",
    run: "2026-07-06T00:00:00.000Z",
    bounds: [-180, -90, 180, 90],
    grid: { width: 1440, height: 721, res: 0.25 },
    steps: [{ fhr: 0, validTime: "2026-07-06T00:00:00.000Z" }],
    variables: {
      sst: base("sst", 200),
      sst100: base("sst100", 180),
      sst500: base("sst500", 140),
      sst2000: base("sst2000", 60),
      sst5000: base("sst5000", 40),
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockLoadTexture.mockReset();
  mockLoadTexture.mockImplementation(async (url: string) => {
    const byte = { "https://tex/sst": 200, "https://tex/sst100": 180, "https://tex/sst500": 140, "https://tex/sst2000": 60, "https://tex/sst5000": 40 }[url];
    if (byte === undefined) throw new Error(`no fixture for ${url}`);
    return flatTexture(byte);
  });
});

describe("sampleDepthProfile", () => {
  it("samples all 5 chapters shallow-to-deep, decoding bytes via each variable's imageUnscale", async () => {
    const points = await sampleDepthProfile(makeManifest(), 0, 0);
    expect(points).not.toBeNull();
    expect(points!.map((p) => p.depth)).toEqual([0, 100, 500, 2000, 5000]);
    // byteToValue(byte, [-5,40]): -5 + byte/255*45
    expect(points![0].tempC).toBeCloseTo(-5 + (200 / 255) * 45, 5);
    expect(points![4].tempC).toBeCloseTo(-5 + (40 / 255) * 45, 5);
  });

  it("carries each chapter's OWN colour domain (deep water isn't coloured on the surface's -2..32 scale)", async () => {
    const points = await sampleDepthProfile(makeManifest(), 0, 0);
    const byDepth = Object.fromEntries(points!.map((p) => [p.depth, p]));
    expect(byDepth[0].domain).toEqual(getVariable("sst")!.domain);
    expect(byDepth[5000].domain).toEqual(getVariable("sst5000")!.domain);
    expect(byDepth[0].domain).not.toEqual(byDepth[5000].domain);
    expect(byDepth[0].palette).toBe("sst");
  });

  it("skips a chapter missing from the manifest and still returns the rest", async () => {
    const manifest = makeManifest();
    delete (manifest.variables as any).sst2000;
    const points = await sampleDepthProfile(manifest, 0, 0);
    expect(points!.map((p) => p.depth)).toEqual([0, 100, 500, 5000]);
  });

  it("skips a chapter whose texture fails to load and continues with the rest", async () => {
    mockLoadTexture.mockImplementation(async (url: string) => {
      if (url === "https://tex/sst500") throw new Error("404");
      const byte = { "https://tex/sst": 200, "https://tex/sst100": 180, "https://tex/sst2000": 60, "https://tex/sst5000": 40 }[url]!;
      return flatTexture(byte);
    });
    const points = await sampleDepthProfile(makeManifest(), 0, 0);
    expect(points!.map((p) => p.depth)).toEqual([0, 100, 2000, 5000]);
  });

  it("returns null over land (no chapter has data at this point)", async () => {
    mockLoadTexture.mockImplementation(async () => flatTexture(0, 0)); // alpha 0 = nodata everywhere
    const points = await sampleDepthProfile(makeManifest(), 40, -100);
    expect(points).toBeNull();
  });

  it("returns null when fewer than 2 chapters have data", async () => {
    const manifest = makeManifest();
    delete (manifest.variables as any).sst100;
    delete (manifest.variables as any).sst500;
    delete (manifest.variables as any).sst2000;
    delete (manifest.variables as any).sst5000;
    const points = await sampleDepthProfile(manifest, 0, 0);
    expect(points).toBeNull();
  });
});
