/**
 * Write a draft ShortScript from the lineup template (docs/short-video-plan.md
 * §4) — the code behind the `short-video.generate` job and the
 * `yarn short:generate` one-shot, which run the exact same path (the CLI can
 * also do it without saving).
 *
 * Lives here, not in jobs/short-video.ts: the job loader registers EVERY export
 * of a jobs/*.ts file as a handler, so that file exports handlers only.
 *
 * Thresholds and holds come from the target scene's director config and the
 * read pace from its ControlState (default the `shorts` render scene), so a
 * short is tuned where the live channels are.
 */
import { randomUUID } from "node:crypto";
import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig } from "@photonsurge/shared/director";
import { clampReadCps } from "@photonsurge/shared/reading-pace";
import { sanitizeInclude, sanitizeScope, type ShortScript } from "@photonsurge/shared/short-script";
import { SHORTS_SCENE_ID } from "@photonsurge/shared/short-scenes";
import { buildLineup } from "./script-template";

export interface GenerateRequest {
  /** A ShortScope; validated here (unknown country/area ids fail in the template). */
  scope: unknown;
  /** Event switches; each is off unless literally true (round-up only by default). */
  include?: unknown;
  /** Target length, ms. */
  budgetMs?: number;
  /** Overrides the template's title. */
  title?: string;
  /** Scene whose director config and read pace tune the lineup; default `shorts`. */
  sceneId?: string;
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
 * the script either way. Throws on a malformed scope, an unknown country/area,
 * and a round-up-only video whose scope has no usable round-up.
 */
export async function generateShortScript(
  db: AppDb,
  req: GenerateRequest,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<ShortScript> {
  const scope = sanitizeScope(req.scope);
  if (!scope) throw new Error(`short-video: scope must be { type: "country" | "area", id } or { type: "globe" }`);
  const include = sanitizeInclude(req.include);
  const budgetMs = typeof req.budgetMs === "number" && Number.isFinite(req.budgetMs) && req.budgetMs > 0 ? req.budgetMs : undefined;
  const sceneId = req.sceneId?.trim() || SHORTS_SCENE_ID;
  const [cfg, readCps] = await Promise.all([sceneDirectorConfig(db, sceneId, opts.dryRun), sceneReadCps(db, sceneId)]);
  const lineup = await buildLineup(db, cfg, { scope, include, budgetMs, readCps, now: opts.now });
  const script: ShortScript = {
    id: randomUUID(),
    template: "lineup",
    scope,
    include,
    title: req.title?.trim() || lineup.title,
    clips: lineup.clips,
    status: "draft",
  };
  return opts.dryRun ? script : db.shortScripts.upsert(script);
}
