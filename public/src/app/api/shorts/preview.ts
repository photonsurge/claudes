/**
 * Format scenes as the /api/shorts routes see them. Every script plays on its
 * FORMAT's own scene (docs/short-video-plan.md §5.3), preview and render
 * alike, and these routes only ever read or write a format scene's director
 * config. Plays and stops go through `db.saveDirectorConfig`, the same
 * merge-and-persist path the director config PATCH route uses; the worker's
 * script runner picks them up.
 */
import type { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_SHORT_FORMAT_ID, DEFAULT_SHORT_FORMAT_NAME } from "@photonsurge/shared/short-scenes";
import type { ShortFormatRow, ShortPreviewInfo } from "../../../lib/shorts";

type AppDb = Awaited<ReturnType<typeof getAppDb>>;

export const NO_CACHE = { "Cache-Control": "no-store" };

/** Shown when a format's scene doesn't exist: nothing renders a play there until it does. */
export function noFormatScene(sceneId: string): string {
  return sceneId === DEFAULT_SHORT_FORMAT_ID
    ? `The default format's scene "${sceneId}" doesn't exist yet — run "Seed default short format" on /admin/jobs ` +
        `(or \`yarn seed:short-format\` in worker), then restart the worker.`
    : `The format scene "${sceneId}" doesn't exist — duplicate the format again from /admin/shorts.`;
}

/** Existence, watch token and director state of one format's scene. A missing
 *  scene reports `mode: "off"` without seeding a director config for it. */
export async function previewInfo(db: AppDb, sceneId: string): Promise<ShortPreviewInfo> {
  const scene = (await db.getScene(sceneId)) as { watchToken?: string } | null;
  if (!scene) return { sceneId, exists: false, mode: "off" };
  const cfg = await db.getOrInitDirectorConfig(sceneId);
  return {
    sceneId,
    exists: true,
    watchToken: scene.watchToken,
    mode: cfg.mode,
    scriptId: cfg.script?.scriptId,
    playNonce: cfg.script?.playNonce,
  };
}

/**
 * Every format with its scene's state, the default first. The default is
 * listed even before it's seeded, so the page always has somewhere to say so.
 */
export async function formatRows(db: AppDb): Promise<ShortFormatRow[]> {
  const formats = await db.shortFormats.list();
  const named = formats.some((f) => f.id === DEFAULT_SHORT_FORMAT_ID)
    ? formats
    : [{ id: DEFAULT_SHORT_FORMAT_ID, name: DEFAULT_SHORT_FORMAT_NAME }, ...formats];
  const ordered = [...named].sort((a, b) => (a.id === DEFAULT_SHORT_FORMAT_ID ? -1 : b.id === DEFAULT_SHORT_FORMAT_ID ? 1 : 0));
  return Promise.all(
    ordered.map(async (f) => ({
      id: f.id,
      name: f.name,
      // What the Generate form's "world round-up first" starts from (several places).
      openWithWorld: "template" in f ? f.template.openWithWorld : false,
      preview: await previewInfo(db, f.id),
    })),
  );
}

/**
 * Start `scriptId` playing on `sceneId` (its format's scene) from `fromClip`,
 * as an editor preview (`record: false` — no as-run log). The nonce is a
 * timestamp, never below the last one + 1, so it never repeats one the runner
 * already answered (its restart guard) — the same rule as the `yarn
 * short:play` one-shot.
 */
export async function startPreviewPlay(db: AppDb, sceneId: string, scriptId: string, fromClip: number): Promise<number> {
  const cfg = await db.getOrInitDirectorConfig(sceneId);
  const playNonce = Math.max((cfg.script?.playNonce ?? 0) + 1, Date.now());
  await db.saveDirectorConfig(sceneId, {
    mode: "script",
    script: { scriptId, fromClip, playNonce, record: false },
  });
  return playNonce;
}

/** Stop whatever a format scene is playing — mode `off`; the runner stamps the play stopped. */
export async function stopPreviewPlay(db: AppDb, sceneId: string): Promise<void> {
  await db.saveDirectorConfig(sceneId, { mode: "off" });
}
