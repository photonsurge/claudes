/**
 * Volcano ids are `gvp:<vnum>` (e.g. `gvp:264180`). The colon is hostile in a URL
 * path — encoded to `%3A` it mis-round-trips through Next route params — so admin
 * routes carry the BARE vnum and reconstruct the full id server-side.
 */

/** Full id → URL-safe segment (drop the `gvp:` prefix so there's no colon). */
export function volcanoUrlId(id: string): string {
  return id.replace(/^gvp:/, "");
}

/** Route param (bare vnum, or a full/encoded id from an old link) → full `gvp:<vnum>` id. */
export function normalizeVolcanoId(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* raw wasn't percent-encoded — use as-is */
  }
  return s.startsWith("gvp:") ? s : `gvp:${s}`;
}
