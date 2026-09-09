import * as WL from "weatherlayers-gl";
import { TEXTURE_LOAD_TIMEOUT_MS, clearTextureCache, isTextureCached, loadTexture, textureSizeLine } from "./textures";

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
