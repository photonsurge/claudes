import { BROADCAST_FONT_FACES, SUBSET_SAMPLE, warmFonts } from "./useFontWarmup";

describe("warmFonts", () => {
  it("requests every face of the ramp with a sample spanning the served subsets", async () => {
    const calls: [string, string | undefined][] = [];
    await warmFonts({ load: (font, text) => (calls.push([font, text]), Promise.resolve([])) });
    expect(calls.map(([font]) => font)).toEqual([...BROADCAST_FONT_FACES]);
    for (const [, text] of calls) expect(text).toBe(SUBSET_SAMPLE);
    // latin, latin-ext, vietnamese, cyrillic, greek
    expect(SUBSET_SAMPLE).toMatch(/A/);
    expect(SUBSET_SAMPLE).toMatch(/ą/);
    expect(SUBSET_SAMPLE).toMatch(/ạ/);
    expect(SUBSET_SAMPLE).toMatch(/Ж/);
    expect(SUBSET_SAMPLE).toMatch(/α/);
  });

  it("settles even when a face fails, and is a no-op without a font set", async () => {
    await expect(warmFonts({ load: () => Promise.reject(new Error("offline")) })).resolves.toBeDefined();
    await expect(warmFonts(undefined)).resolves.toBeUndefined();
  });
});
