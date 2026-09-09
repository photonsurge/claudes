import * as WL from "weatherlayers-gl";
import { TEXTURE_LOAD_TIMEOUT_MS, clearTextureCache, isTextureCached, loadTexture, cacheBytesFrom, cacheMaxFrom, textureBytes, textureSizeLine } from "./textures";

type Loader = typeof WL.loadTextureData;
const original: Loader = WL.loadTextureData;
let impl: Loader = original;

// textures.ts captures `loadTextureData` once (lazy import on first use), so
// the spy has to be in place before the first load; each test steers it
// through `impl` instead of re-spying.
beforeAll(() => {
  jest.spyOn(WL, "loadTextureData").mockImplementation((url: string) => impl(url));
});
beforeEach(() => {
  impl = original;
  (WL.loadTextureData as unknown as jest.Mock).mockClear();
  clearTextureCache();
});
afterEach(() => jest.useRealTimers());
afterAll(() => jest.restoreAllMocks());

describe("loadTexture", () => {
  it("dedupes concurrent requests for one URL and caches the decoded promise", async () => {
    const a = loadTexture("/x.png");
    const b = loadTexture("/x.png");
    expect(b).toBe(a);
    await a;
    expect(isTextureCached("/x.png")).toBe(true);
    expect(WL.loadTextureData).toHaveBeenCalledTimes(1);
  });

  it("gives up on a hung fetch after TEXTURE_LOAD_TIMEOUT_MS and lets the next request retry", async () => {
    jest.useFakeTimers();
    let calls = 0;
    impl = () => {
      calls += 1;
      // First call never settles (a stalled response body); the second decodes.
      return calls === 1
        ? new Promise(() => {})
        : Promise.resolve({ data: new Uint8Array(4), width: 1, height: 1 });
    };
    const outcome = loadTexture("/hung.png").then(
      () => "resolved",
      (e: Error) => e.message,
    );
    // Let the lazy loader hand-off settle so the timeout race is armed.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    jest.advanceTimersByTime(TEXTURE_LOAD_TIMEOUT_MS);
    await expect(outcome).resolves.toMatch(/timed out after 90000 ms: \/hung\.png/);
    // The failed entry is dropped, so a later request really refetches.
    expect(isTextureCached("/hung.png")).toBe(false);
    await expect(loadTexture("/hung.png")).resolves.toEqual({ data: new Uint8Array(4), width: 1, height: 1 });
    expect(calls).toBe(2);
  });
});

describe("textureSizeLine", () => {
  it("names the file and reports its grid and megabytes", () => {
    const t = { data: new Uint8Array(1440 * 721 * 4), width: 1440, height: 721 };
    expect(textureSizeLine("https://x/y/humidity-abc.png?v=9", t as never)).toBe(
      "[globe] texture humidity-abc.png 1440\u00d7721 4.0 MB",
    );
  });

  it("survives a texture with nothing on it", () => {
    expect(textureSizeLine("a/b.png", undefined as never)).toBe("[globe] texture b.png 0\u00d70 0.0 MB");
  });
});

describe("cacheMaxFrom", () => {
  it("takes a sane override and ignores nonsense", () => {
    expect(cacheMaxFrom("512")).toBe(512);
    expect(cacheMaxFrom("512.7")).toBe(512);
    expect(cacheMaxFrom(undefined)).toBe(256);
    expect(cacheMaxFrom("")).toBe(256);
    expect(cacheMaxFrom("lots")).toBe(256);
    expect(cacheMaxFrom("0")).toBe(256);
    expect(cacheMaxFrom("-5")).toBe(256);
  });
});

describe("cacheBytesFrom / textureBytes", () => {
  it("reads a megabyte budget, defaulting to 1536 MB", () => {
    expect(cacheBytesFrom("512")).toBe(512 * 1048576);
    expect(cacheBytesFrom(undefined)).toBe(1536 * 1048576);
    expect(cacheBytesFrom("nonsense")).toBe(1536 * 1048576);
    expect(cacheBytesFrom("0")).toBe(1536 * 1048576);
  });

  it("weighs a texture by its decoded bytes, not its dimensions", () => {
    // The spread that makes a count cap meaningless: 4500x2250 is 38.6 MB,
    // 241x151 is 0.1 MB, and 256 of each differ by ~10 GB.
    const big = { data: new Uint8Array(4500 * 2250 * 4), width: 4500, height: 2250 };
    const small = { data: new Uint8Array(241 * 151 * 4), width: 241, height: 151 };
    expect(textureBytes(big as never)).toBe(4500 * 2250 * 4);
    expect(textureBytes(big as never) / textureBytes(small as never)).toBeGreaterThan(250);
    expect(textureBytes(undefined)).toBe(0);
  });
});
