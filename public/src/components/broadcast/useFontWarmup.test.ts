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

  // The one face that cannot be recovered from if it arrives late: the encoder's
  // Chromium has no font covering U+1F1E6-1F1FF, so an unwarmed flag face means
  // .notdef boxes on air for the whole of its fetch. `document.fonts.load` only
  // requests faces whose unicode-range covers the sample, so the sample has to
  // carry a regional-indicator pair, and the canonical family has to be asked for.
  it("warms the self-hosted flag face", () => {
    const flags = [...SUBSET_SAMPLE].filter((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return cp >= 0x1f1e6 && cp <= 0x1f1ff;
    });
    expect(flags.length).toBeGreaterThanOrEqual(2);
    expect(BROADCAST_FONT_FACES).toContain("400 16px 'Noto Color Emoji Flags'");
    // The Google faces stay warmed too, but only for their own latin subsets:
    // they carry no flag glyphs, and the attempt to make them do so is what
    // failed on air (see lib/fonts.ts).
    expect(BROADCAST_FONT_FACES.some((f) => f.includes("Saira"))).toBe(true);
    expect(BROADCAST_FONT_FACES.some((f) => f.includes("JetBrains Mono"))).toBe(true);
  });

  it("settles even when a face fails, and is a no-op without a font set", async () => {
    await expect(warmFonts({ load: () => Promise.reject(new Error("offline")) })).resolves.toBeDefined();
    await expect(warmFonts(undefined)).resolves.toBeUndefined();
  });
});
