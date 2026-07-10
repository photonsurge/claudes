import type { AppDb } from "../db/index";
import type { AdminEntityType, AdminImage, AdminTextOverrides } from "./types";
import { mergeTextOverrides } from "./types";
import { ENTITY_SCHEMAS, editableFieldKeys } from "./schema";

/** A base entity is just a bag of fields; its exact shape varies per type. */
export type AdminEntity = Record<string, any>;

export interface ResolvedContent {
  type: AdminEntityType;
  /** The entity's stable id (also the content key). */
  entityId: string;
  /** The base entity with text overrides applied, or null if it's gone. */
  entity: AdminEntity | null;
  /** Every uploaded image, primary first then by sort. */
  images: AdminImage[];
  /** The raw stored overrides (so the editor can show what's been changed). */
  text: AdminTextOverrides;
}

/** Load the raw base entity for `(type, id)`, or null if it doesn't exist. */
export async function loadAdminBase(
  db: AppDb,
  type: AdminEntityType,
  id: string,
): Promise<AdminEntity | null> {
  switch (type) {
    case "city": {
      const r = await db.cities.getByID(id);
      return r.success && r.data ? (r.data as AdminEntity) : null;
    }
    case "country":
      return (await db.countries.get(id)) as AdminEntity | null;
    case "region":
      return (await db.regions.get(id)) as AdminEntity | null;
    case "volcano":
      return (await db.volcanoes.get(id)) as AdminEntity | null;
    case "alert":
      return (await db.alerts.getById(id)) as AdminEntity | null;
    case "quake":
      return (await db.quakes.get(id)) as AdminEntity | null;
    case "seismic":
      return (await db.seismoStations.get(id)) as AdminEntity | null;
    default:
      return null;
  }
}

/**
 * Overlay text overrides onto a base entity. Most entities apply a shallow
 * top-level merge; an alert's editable text lives on its primary `info[]` block,
 * so it's applied there instead.
 */
export function applyTextOverrides(
  type: AdminEntityType,
  base: AdminEntity,
  text: AdminTextOverrides,
): AdminEntity {
  if (type === "alert") {
    const info = Array.isArray(base.info) ? base.info.map((b: any) => ({ ...b })) : [{}];
    const first = info[0] ?? {};
    for (const f of ENTITY_SCHEMAS.alert.fields) {
      const v = text[f.field];
      if (typeof v === "string" && v.trim() !== "") first[f.field] = v.trim();
    }
    info[0] = first;
    return { ...base, info };
  }
  return mergeTextOverrides(base, text, editableFieldKeys(type));
}

/** The stable id for a base entity of a given type. */
export const entityIdOf = (type: AdminEntityType, base: AdminEntity): string =>
  String(base[ENTITY_SCHEMAS[type].idField] ?? "");

/**
 * The full merged read for one entity: base doc + text overrides applied +
 * every uploaded image. This is what the admin detail page and the on-air
 * preview consume. Returns null when the base entity no longer exists.
 */
export async function resolveAdminContent(
  db: AppDb,
  type: AdminEntityType,
  id: string,
): Promise<ResolvedContent | null> {
  const base = await loadAdminBase(db, type, id);
  if (!base) return null;
  const entityId = entityIdOf(type, base) || id;
  const [text, images] = await Promise.all([
    db.adminEdits.textFor(type, entityId),
    db.adminImages.list(type, entityId),
  ]);
  return { type, entityId, entity: applyTextOverrides(type, base, text), images, text };
}

/** One list row's admin-content decoration. */
export interface ListContentEntry<T = AdminEntity> {
  entity: T;
  imageCount: number;
  /** The primary image id (for a hero thumbnail), or null. */
  primaryImageId: string | null;
  /** True when the operator has saved any text override. */
  edited: boolean;
}

/**
 * Batch-decorate a list of base entities with their overrides + image summary,
 * in one round-trip each for text and images. Lets a list page show edited
 * names and a hero thumbnail without an N+1 fan-out.
 */
export async function resolveAdminList<T extends AdminEntity>(
  db: AppDb,
  type: AdminEntityType,
  items: T[],
  idOf: (item: T) => string,
): Promise<ListContentEntry<T>[]> {
  const ids = items.map(idOf);
  const [textMap, imgMap] = await Promise.all([
    db.adminEdits.textForEntities(type, ids),
    db.adminImages.listForEntities(type, ids),
  ]);
  return items.map((item) => {
    const id = idOf(item);
    const text = textMap.get(id) ?? {};
    const images = imgMap.get(id) ?? [];
    const primary = images.find((i) => i.primary) ?? images[0] ?? null;
    return {
      entity: applyTextOverrides(type, item, text) as T,
      imageCount: images.length,
      primaryImageId: primary ? primary.id : null,
      edited: Object.keys(text).length > 0,
    };
  });
}
