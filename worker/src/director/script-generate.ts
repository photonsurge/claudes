/**
 * Write a draft ShortScript from the lineup template (docs/short-video-plan.md
 * §4) — the code behind the `short-video.generate` job and the
 * `yarn short:generate` one-shot, which run the exact same path (the CLI can
 * also do it without saving).
 *
 * Lives here, not in jobs/short-video.ts: the job loader registers EVERY export
 * of a jobs/*.ts file as a handler, so that file exports handlers only.
 *
 * Generate takes a FORMAT (docs/short-video-plan.md §5.4, default the default
 * format): scope, switches and budget default from its template; thresholds,
 * holds and the read pace come from its scene (the director config and
 * ControlState of the scene with the format's id); its opener and close
 * settings shape the lineup. The script records the format, so it plays on
 * that format's scene.
 */
import { randomUUID } from "node:crypto";
import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig } from "@photonsurge/shared/director";
import { clampReadCps } from "@photonsurge/shared/reading-pace";
import { sanitizeInclude, sanitizeScope, type ShortScript } from "@photonsurge/shared/short-script";
import { DEFAULT_SHORT_FORMAT_ID, defaultShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import { buildLineup, type SkippedPlace } from "./script-template";

export interface GenerateRequest {
  /** The format to make the video in; default the default format. */
  formatId?: string;
  /** A ShortScope; validated here (unknown country/area ids fail in the
   *  template). Absent = the format template's scope. */
  scope?: unknown;
  /** Event switches; each is off unless literally true. Absent = the format template's switches. */
  include?: unknown;
  /** Target length, ms. Absent = the format template's budget. */
  budgetMs?: number;
  /** Overrides the template's title. */
  title?: string;
  /** Several places: open on the world round-up first. Absent = the format
   *  template's `openWithWorld`. Ignored for other scopes. */
  openWithWorld?: boolean;
}

/**
 * The request's format. The default format works before it is seeded (its
 * defaults, on the `shorts` scene); any other id must exist.
 */
export async function generateFormat(db: AppDb, formatId?: string): Promise<ShortFormat> {
  const id = formatId?.trim() || DEFAULT_SHORT_FORMAT_ID;
  const format = await db.shortFormats.get(id);
  if (format) return format;
  if (id === DEFAULT_SHORT_FORMAT_ID) return defaultShortFormat();
  throw new Error(`short-video: no format "${id}" — pick one from /admin/shorts`);
}

/**
 * The scene's director config. `readOnly` skips `getOrInitDirectorConfig`'s
 * first-read insert, so a dry run never writes.
 */
export async function sceneDirectorConfig(db: AppDb, sceneId: string, readOnly = false): Promise<DirectorConfig> {
  if (!readOnly) return db.getOrInitDirectorConfig(sceneId);
  const existing = await db.directorConfig.getByID(sceneId);
  return existing.success && existing.data
    ? mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, existing.data as any)
    : { ...DEFAULT_DIRECTOR_CONFIG };
}

/**
 * The scene's on-air read pace (`ControlState.readPaceCps`), clamped; the
 * default pace for a scene that doesn't exist yet. A plain read — never the
 * get-or-init / token-backfill paths, so a dry run writes nothing.
 */
export async function sceneReadCps(db: AppDb, sceneId: string): Promise<number> {
  const res = await db.broadcastState.getByID(sceneId).catch(() => null);
  return clampReadCps(res?.success ? (res.data as { readPaceCps?: unknown } | null)?.readPaceCps : undefined);
}

/**
 * Build a draft script for the request and (unless `dryRun`) save it. Returns
 * the script and, for a several-places video, the places it left out (no
 * usable round-up) and why. Throws on a malformed scope, an unknown
 * country/area, a round-up-only video whose scope has no usable round-up, and
 * a several-places video with no place left.
 */
export async function generateShort(
  db: AppDb,
  req: GenerateRequest,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<{ script: ShortScript; skipped: SkippedPlace[] }> {
  const format = await generateFormat(db, req.formatId);
  const scope = req.scope != null ? sanitizeScope(req.scope) : format.template.scope ?? null;
  if (!scope) {
    throw new Error(
      `short-video: scope must be { type: "country" | "area", id }, { type: "globe" } or { type: "places", places: [...] } ` +
        `with at least one known place` +
        (req.scope == null ? ` — the format "${format.name}" names none, so the request must` : ""),
    );
  }
  const include = req.include != null ? sanitizeInclude(req.include) : { ...format.template.include };
  const budgetMs =
    typeof req.budgetMs === "number" && Number.isFinite(req.budgetMs) && req.budgetMs > 0 ? req.budgetMs : format.template.budgetMs;
  const openWithWorld = typeof req.openWithWorld === "boolean" ? req.openWithWorld : format.template.openWithWorld;
  // The format's scene: its id is the format's.
  const sceneId = format.id;
  const [cfg, readCps] = await Promise.all([sceneDirectorConfig(db, sceneId, opts.dryRun), sceneReadCps(db, sceneId)]);
  const lineup = await buildLineup(db, cfg, { scope, include, budgetMs, readCps, shape: format, openWithWorld, now: opts.now });
  const script: ShortScript = {
    id: randomUUID(),
    formatId: format.id,
    template: "lineup",
    scope,
    include,
    title: req.title?.trim() || lineup.title,
    clips: lineup.clips,
    status: "draft",
  };
  const saved = opts.dryRun ? script : await db.shortScripts.upsert(script);
  return { script: saved, skipped: lineup.skipped ?? [] };
}

/** `generateShort`, the script alone. */
export async function generateShortScript(
  db: AppDb,
  req: GenerateRequest,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<ShortScript> {
  return (await generateShort(db, req, opts)).script;
}
