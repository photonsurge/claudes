/**
 * Admin content-editing domain — the shared vocabulary for the "edit any catalog
 * item's text + images" admin feature. Manual edits are stored DECOUPLED from the
 * entity docs (in their own `AdminEdit` / `AdminImage` collections, keyed by
 * `(entityType, entityId)`) so they survive everything the feeds do to the base
 * docs: quake TTL-expiry, the seismic-station full-replace, and the
 * city/country/region/volcano re-enrichment all leave manual edits untouched.
 *
 * The bytes live in Mongo (like ads); the wire shapes here never carry them.
 */

/** The catalog/signal entities that support admin content editing. */
export type AdminEntityType =
  | "city"
  | "country"
  | "region"
  | "volcano"
  | "alert"
  | "quake"
  | "seismic";

export const ADMIN_ENTITY_TYPES: AdminEntityType[] = [
  "city",
  "country",
  "region",
  "volcano",
  "alert",
  "quake",
  "seismic",
];

export const isAdminEntityType = (v: unknown): v is AdminEntityType =>
  typeof v === "string" && (ADMIN_ENTITY_TYPES as string[]).includes(v);

/** Image content-types accepted for upload (mirrors the ads image set). */
export const ADMIN_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/**
 * Ceiling for an inline (on-doc) image. Mongo caps a document at 16 MB; keep a
 * margin for metadata. Matches the ads inline cap.
 */
export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

/** True if `contentType` is an image type we accept for upload. */
export const adminImageTypeOk = (contentType: string): boolean => {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return (ADMIN_IMAGE_TYPES as readonly string[]).includes(ct);
};

/**
 * The serve URL for an admin-uploaded image's bytes, cache-busted by its last
 * edit. Shared so the admin UI, the on-air preview and (later) the broadcast all
 * build the exact same URL. `v` should be the image's `updatedAt` (epoch ms).
 */
export const adminMediaPath = (imageId: string, v?: number): string =>
  `/api/media/${encodeURIComponent(imageId)}?v=${v ?? 0}`;

/** The canonical wire shape for one admin image. No bytes. */
export interface AdminImage {
  id: string;
  entityType: AdminEntityType;
  entityId: string;
  contentType: string;
  byteSize: number;
  caption?: string;
  credit?: string;
  /** Exactly one image per (entityType, entityId) is the primary/hero. */
  primary: boolean;
  /** Display order within the entity's gallery (ascending). */
  sort: number;
  /** Epoch ms. */
  createdAt?: number;
  /** Epoch ms — also the media-URL cache-buster. */
  updatedAt?: number;
}

/**
 * A field-keyed map of manual text overrides for one entity. Keys are the
 * `field` ids from that entity's edit schema; a non-empty value replaces the
 * base field at read time, an empty/absent value falls back to the base.
 */
export type AdminTextOverrides = Record<string, string>;

/** The canonical wire shape for one entity's stored text overrides. */
export interface AdminEdit {
  entityType: AdminEntityType;
  entityId: string;
  text: AdminTextOverrides;
  /** Epoch ms. */
  updatedAt?: number;
}

/**
 * Overlay text overrides onto a base entity. Only non-empty string values are
 * applied, and only for keys the base already carries as strings OR that the
 * caller explicitly allows via `extraKeys` (e.g. a field the base leaves unset).
 * Generic + shallow: nested shapes (e.g. an alert's `info[]`) apply overrides in
 * their own read path, not here.
 */
export function mergeTextOverrides<T extends Record<string, unknown>>(
  base: T,
  text: AdminTextOverrides | undefined,
  extraKeys: string[] = [],
): T {
  if (!text) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(text)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (key in out || extraKeys.includes(key)) out[key] = value;
  }
  return out as T;
}

/** Drop empty/whitespace values so clearing a field falls back to the base. */
export function pruneOverrides(text: AdminTextOverrides): AdminTextOverrides {
  const out: AdminTextOverrides = {};
  for (const [key, value] of Object.entries(text)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}
