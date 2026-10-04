/**
 * Making and re-copying short formats (docs/short-video-plan.md §5.1-5.2).
 *
 * A format is made by DUPLICATING a channel or another format: its scene doc
 * (the whole on-air look) and director config (thresholds, holds, per-shot
 * looks) are copied into a new hidden scene with `kind: "short"`, and there is
 * no link back — a later change to the source changes nothing in the format.
 * From a format the short settings are copied too; from a channel they start at
 * the defaults.
 *
 * "Copy look from…" (`copyLookFrom`) is the only way a source's later changes
 * reach a format: it re-copies the look and director config and keeps the
 * format's short settings and its scene's id, name, kind and watch token.
 *
 * Shared by the /api/shorts/formats routes (public) and the worker, so both
 * copy exactly the same way.
 */
import type { AppDb } from "./index";
import {
  DEFAULT_CONTROL_STATE,
  MAIN_SCENE_ID,
  mergeControlState,
  sceneKindOf,
  slugifySceneId,
  type ControlState,
} from "../control";
import type { DirectorConfig } from "../director";
import { DEFAULT_SHORT_FORMAT_ID, sanitizeShortFormat, type ShortFormat } from "../short-format";

/** What a format is copied from: a channel's scene, or another format. */
export type FormatSource = { type: "channel"; sceneId: string } | { type: "format"; format: ShortFormat };

export type FormatCopyResult =
  | { ok: true; format: ShortFormat }
  | { ok: false; code: "bad-name" | "exists" | "no-source"; error: string };

/** Prefix on every format id but the default's, so a format scene's
 *  /watch/<id> URL says what it is and a format never takes a channel's id. */
export const FORMAT_ID_PREFIX = "short-";

/** The id (= scene id) a new format named `name` gets: "short-<slug>", or "" when the name has no usable characters. */
export function formatIdForName(name: string): string {
  const slug = slugifySceneId(name);
  return slug ? `${FORMAT_ID_PREFIX}${slug}` : "";
}

/**
 * Which kind of thing `from` names. A format's id is also its scene's id, so a
 * format wins; any other existing scene is a channel. Null when neither exists.
 */
export async function resolveFormatSource(db: AppDb, from: string): Promise<FormatSource | null> {
  const id = String(from ?? "").trim();
  if (!id) return null;
  const format = await db.shortFormats.get(id);
  if (format) return { type: "format", format };
  if (id === MAIN_SCENE_ID) return { type: "channel", sceneId: id };
  const scene = await db.getScene(id);
  // A short scene with no settings doc (a half-made format) is still a scene to copy from.
  return scene ? { type: "channel", sceneId: id } : null;
}

const sourceSceneId = (src: FormatSource) => (src.type === "format" ? src.format.id : src.sceneId);

/** The source scene's look, stripped to ControlState (no id, name, kind or token). */
async function sourceLook(db: AppDb, sceneId: string): Promise<ControlState> {
  const doc = sceneId === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(sceneId);
  return mergeControlState(DEFAULT_CONTROL_STATE, (doc ?? {}) as Partial<ControlState>);
}

/**
 * The source's director setup (kinds, holds, thresholds, looks) without its
 * runtime fields — the script-play trigger, the mode and the skip nonce belong
 * to the scene they were set on.
 */
async function sourceDirector(db: AppDb, sceneId: string): Promise<Partial<DirectorConfig>> {
  const { script: _script, mode: _mode, skipNonce: _skip, ...rest } = await db.getOrInitDirectorConfig(sceneId);
  return rest;
}

/**
 * Make a new format named `name` by duplicating `from` (a channel's scene id or
 * a format id). The new format's id is `formatIdForName(name)` unless `id` is
 * given. Refuses a name with no usable characters, an id already taken by a
 * scene or a format, and a source that doesn't exist.
 */
export async function duplicateFormat(
  db: AppDb,
  req: { name: string; from: string; id?: string },
): Promise<FormatCopyResult> {
  const name = String(req.name ?? "").trim();
  const id = req.id?.trim() || formatIdForName(name);
  if (!name || !id) return { ok: false, code: "bad-name", error: "a non-empty name is required" };
  if (id === MAIN_SCENE_ID || (await db.getScene(id)) || (await db.shortFormats.get(id))) {
    return { ok: false, code: "exists", error: `a scene or format with the id "${id}" already exists` };
  }
  const src = await resolveFormatSource(db, req.from);
  if (!src) return { ok: false, code: "no-source", error: `no channel or format "${req.from}" to duplicate` };

  const from = sourceSceneId(src);
  const [look, director] = await Promise.all([sourceLook(db, from), sourceDirector(db, from)]);
  await db.createScene(id, name, look, { hidden: true, kind: "short" });
  // A fresh format never starts playing on its own.
  await db.saveDirectorConfig(id, { ...director, mode: "off", skipNonce: 0 });

  // From a format the short settings come too; from a channel they start at the defaults.
  const settings = sanitizeShortFormat(src.type === "format" ? { ...src.format, id, name } : { id, name })!;
  const format = await db.shortFormats.upsert(settings);
  return { ok: true, format };
}

/**
 * "Copy look from…": re-copy the look (scene ControlState) and director setup
 * of `from` onto format `formatId`'s scene. Keeps the format's short settings,
 * and its scene's id, name, kind, hidden flag and watch token; keeps its
 * director mode and script trigger, so a play in progress isn't cut off.
 * Copying a format onto itself is refused as pointless.
 */
export async function copyLookFrom(db: AppDb, formatId: string, from: string): Promise<FormatCopyResult> {
  const format = await db.shortFormats.get(formatId);
  if (!format) return { ok: false, code: "no-source", error: `no format "${formatId}"` };
  const src = await resolveFormatSource(db, from);
  if (!src) return { ok: false, code: "no-source", error: `no channel or format "${from}" to copy from` };
  const sceneId = sourceSceneId(src);
  if (sceneId === formatId) return { ok: false, code: "bad-name", error: "a format can't copy its own look" };

  const [look, director] = await Promise.all([sourceLook(db, sceneId), sourceDirector(db, sceneId)]);
  await db.createScene(formatId, format.name, look, { hidden: true, kind: "short" });
  await db.saveDirectorConfig(formatId, director);
  return { ok: true, format };
}

/**
 * Save a format's short settings and keep its scene's name in step (the scene
 * name is what admin pickers and the chapter job's opening label show).
 */
export async function saveFormat(db: AppDb, format: ShortFormat): Promise<ShortFormat> {
  const saved = await db.shortFormats.upsert(format);
  const scene = await db.getScene(format.id);
  if (scene && scene.name !== format.name) await db.setSceneMeta(format.id, { name: format.name });
  return saved;
}

/** True when `sceneId` is a short format's scene (by its scene doc's kind). */
export async function isFormatScene(db: AppDb, sceneId: string): Promise<boolean> {
  return sceneKindOf(await db.getScene(sceneId)) === "short";
}

export type FormatDeleteResult =
  | { ok: true }
  | { ok: false; code: "default" | "in-use" | "not-found"; error: string; scripts?: number; renders?: number };

/**
 * Delete a format: its settings, its scene and its director config. Refuses the
 * default format, a format any script is made in, and one with videos queued
 * or rendering in it — saying how many, so the operator knows what to delete
 * or move first (§5.5).
 */
export async function deleteFormat(db: AppDb, id: string): Promise<FormatDeleteResult> {
  if (id === DEFAULT_SHORT_FORMAT_ID) {
    return { ok: false, code: "default", error: "the default format can't be deleted" };
  }
  if (!(await db.shortFormats.get(id))) return { ok: false, code: "not-found", error: `no format "${id}"` };
  const scripts = await db.shortScripts.countByFormat(id);
  if (scripts > 0) {
    return {
      ok: false,
      code: "in-use",
      scripts,
      error: `${scripts} script${scripts === 1 ? " uses" : "s use"} this format — delete ${scripts === 1 ? "it" : "them"} first`,
    };
  }
  // Videos queued, preparing or live in it (short-video plan §6.6) would lose
  // their scene mid-render.
  const renders = await db.shortRenders.countByFormat(id);
  if (renders > 0) {
    return {
      ok: false,
      code: "in-use",
      renders,
      error: `${renders} video${renders === 1 ? " is" : "s are"} queued or rendering in this format — wait for ${renders === 1 ? "it" : "them"} or cancel first`,
    };
  }
  await db.shortFormats.remove(id);
  await db.deleteScene(id);
  await db.deleteDirectorConfig(id);
  return { ok: true };
}
