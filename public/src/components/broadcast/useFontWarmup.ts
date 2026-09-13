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
 *
 * The self-hosted flag face (lib/fonts, globals.css) is warmed here too, and
 * for that one it is not a perf nicety: nothing else on the encoder box covers
 * the flag block, so a face still in flight means .notdef boxes on the stream.
 */
import { useEffect } from "react";

/** The faces the chrome uses (GodsBanner / GodsPanel type ramp; ads synthesise 800 from 600),
 *  plus the self-hosted flag family that the body stack (lib/fonts) names directly. */
export const BROADCAST_FONT_FACES = [
  "300 16px Saira",
  "400 16px Saira",
  "500 16px Saira",
  "600 16px Saira",
  "400 16px 'JetBrains Mono'",
  "500 16px 'JetBrains Mono'",
  "400 16px 'Noto Color Emoji Flags'",
] as const;

/**
 * One character from each subset Google serves for these families, followed by
 * a regional-indicator PAIR (🇦🇩).
 *
 * `document.fonts.load` only fetches the faces whose unicode-range covers the
 * sample, so a sample of plain latin asked for every subset EXCEPT the one that
 * cannot be recovered from. A late Google subset merely re-lays-out text that
 * was already legible; the encoder's Chromium owns no font covering the flag
 * block at all, so until this face is in hand `font-display: swap` renders
 * every flag on air as two .notdef boxes.
 */
export const SUBSET_SAMPLE = "A ą ạ Ж α 🇦🇩";

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
