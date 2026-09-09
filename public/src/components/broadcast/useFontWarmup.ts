"use client";

/**
 * Warm every face of the broadcast type ramp once at mount. The fonts come
 * from Google Fonts with `display=swap`, split per weight into unicode-range
 * subsets (latin, latin-ext, vietnamese…), so the first cut whose "Kraków" or
 * "Đà Nẵng" needed an unseen subset fetched it mid-cut, and Blink then re-laid
 * out every text node of that family — the "Fonts changed" invalidations
 * inside one of the ~270 ms full-page layouts on the profiler
 * (docs/watch-perf-plan.md, round 26). Loading the subsets idle at boot moves
 * that off the cut path; the same faces render either way.
 */
import { useEffect } from "react";

/** The faces the chrome uses (GodsBanner / GodsPanel type ramp; ads synthesise 800 from 600). */
export const BROADCAST_FONT_FACES = [
  "300 16px Saira",
  "400 16px Saira",
  "500 16px Saira",
  "600 16px Saira",
  "400 16px 'JetBrains Mono'",
  "500 16px 'JetBrains Mono'",
] as const;

/** One character from each subset Google serves for these families. */
export const SUBSET_SAMPLE = "A ą ạ Ж α";

type FontLoader = { load(font: string, text?: string): Promise<unknown> };

/** Request every face for every subset; resolves once all have settled (never rejects). */
export function warmFonts(fonts: FontLoader | undefined = globalThis.document?.fonts): Promise<unknown> {
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  return Promise.allSettled(BROADCAST_FONT_FACES.map((face) => fonts.load(face, SUBSET_SAMPLE)));
}

export function useFontWarmup(): void {
  useEffect(() => {
    void warmFonts();
  }, []);
}
