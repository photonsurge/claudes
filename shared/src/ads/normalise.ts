/**
 * Pure helpers for cleaning/validating ad metadata before it hits the DB.
 * Shared by the create path (upload, full metadata) and the edit path (partial
 * patch). No I/O and no bytes here — easy to unit test. The media itself
 * (content-type, size, kind) is validated in the route where the file is read.
 */
import { AD_PLACEMENTS, type AdMeta, type AdPlacement, type AdStatus } from "./types";

const STATUSES: AdStatus[] = ["active", "inactive"];

const trimOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
};

const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;

/** Parse a weight: a finite number >= 0, defaulting to 1. */
export function normaliseWeight(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 1;
}

const normaliseTags = (v: unknown): string[] | undefined => {
  const raw = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",")
      : undefined;
  if (!raw) return undefined;
  const tags = Array.from(
    new Set(raw.map((t) => trimOrUndef(t)).filter((t): t is string => Boolean(t))),
  );
  return tags.length ? tags : undefined;
};

/**
 * Parse the placements field — an array or a comma string ("break,ticker"),
 * unknown values dropped, canonical AD_PLACEMENTS order. Nothing valid (or
 * nothing at all) = ["break"]: an ad always runs somewhere, and break is the
 * surface the catalog was built for.
 */
export function normalisePlacements(v: unknown): AdPlacement[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const wanted = new Set(
    raw.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean),
  );
  const placements = AD_PLACEMENTS.filter((p) => wanted.has(p));
  return placements.length ? placements : ["break"];
}

/**
 * Full metadata for a create. Returns null when unusable (a missing title) so
 * the route can reject rather than persist junk. Everything else falls back to
 * a sensible default.
 */
export function normaliseAdMeta(input: Record<string, unknown>): AdMeta | null {
  const title = trimOrUndef(input.title) ?? trimOrUndef(input.name);
  if (!title) return null;
  return {
    title,
    status: oneOf<AdStatus>(input.status, STATUSES, "active"),
    advertiser: trimOrUndef(input.advertiser),
    clickUrl: trimOrUndef(input.clickUrl),
    weight: normaliseWeight(input.weight),
    placements: normalisePlacements(input.placements),
    tags: normaliseTags(input.tags),
    notes: trimOrUndef(input.notes),
  };
}

/**
 * Partial metadata for an edit: only keys actually present in `input` (and
 * valid) are included, so a PATCH touches exactly the fields the operator sent.
 * `clickUrl`/`advertiser`/`notes`/`tags` accept an explicit empty string to
 * clear the field (mapped to `undefined` → `$unset`-equivalent overwrite).
 */
/**
 * Distinct on-air sponsor names from an ad pool — the advertiser field, falling
 * back to the creative's title when no advertiser was set. Order-preserving,
 * case-insensitively deduped (one mention per sponsor however many creatives
 * they run). Feeds the "Sponsored by …" ticker line.
 */
export function sponsorNames(ads: Pick<AdMeta, "advertiser" | "title">[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const ad of ads) {
    const name = trimOrUndef(ad.advertiser) ?? trimOrUndef(ad.title);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function normaliseAdPatch(input: Record<string, unknown>): Partial<AdMeta> {
  const patch: Partial<AdMeta> = {};
  if ("title" in input) {
    const title = trimOrUndef(input.title);
    if (title) patch.title = title; // never blank out the title
  }
  if ("status" in input && STATUSES.includes(input.status as AdStatus)) {
    patch.status = input.status as AdStatus;
  }
  if ("advertiser" in input) patch.advertiser = trimOrUndef(input.advertiser);
  if ("clickUrl" in input) patch.clickUrl = trimOrUndef(input.clickUrl);
  if ("notes" in input) patch.notes = trimOrUndef(input.notes);
  if ("weight" in input) patch.weight = normaliseWeight(input.weight);
  if ("placements" in input) patch.placements = normalisePlacements(input.placements);
  if ("tags" in input) patch.tags = normaliseTags(input.tags);
  return patch;
}
