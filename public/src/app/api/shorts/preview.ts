/**
 * The preview scene (`shorts-preview`) as the /api/shorts routes see it — the
 * ONLY scene these routes ever read or write a director config for. Plays and
 * stops go through `db.saveDirectorConfig`, the same merge-and-persist path the
 * director config PATCH route uses; the worker's script runner picks them up.
 */
import type { getAppDb } from "@photonsurge/shared/db/index";
import { SHORTS_PREVIEW_SCENE_ID } from "@photonsurge/shared/short-scenes";
import type { ShortPreviewInfo } from "../../../lib/shorts";

type AppDb = Awaited<ReturnType<typeof getAppDb>>;

export const NO_CACHE = { "Cache-Control": "no-store" };

/** Shown when the preview scene hasn't been seeded: nothing renders a play until it is. */
export const NO_PREVIEW_SCENE =
  `The preview scene "${SHORTS_PREVIEW_SCENE_ID}" doesn't exist yet — run \`yarn seed:short-scenes\` in worker, ` +
  `then restart the worker.`;

/** Existence, watch token and director state of the preview scene. A missing
 *  scene reports `mode: "off"` without seeding a director config for it. */
export async function previewInfo(db: AppDb): Promise<ShortPreviewInfo> {
  const scene = (await db.getScene(SHORTS_PREVIEW_SCENE_ID)) as { watchToken?: string } | null;
  if (!scene) return { sceneId: SHORTS_PREVIEW_SCENE_ID, exists: false, mode: "off" };
  const cfg = await db.getOrInitDirectorConfig(SHORTS_PREVIEW_SCENE_ID);
  return {
    sceneId: SHORTS_PREVIEW_SCENE_ID,
    exists: true,
    watchToken: scene.watchToken,
    mode: cfg.mode,
    scriptId: cfg.script?.scriptId,
    playNonce: cfg.script?.playNonce,
  };
}

/**
 * Start `scriptId` playing on the preview scene from `fromClip`, as an editor
 * preview (`record: false` — no as-run log). The nonce is a timestamp, never
 * below the last one + 1, so it never repeats one the runner already answered
 * (its restart guard) — the same rule as the `yarn short:play` one-shot.
 */
export async function startPreviewPlay(db: AppDb, scriptId: string, fromClip: number): Promise<number> {
  const cfg = await db.getOrInitDirectorConfig(SHORTS_PREVIEW_SCENE_ID);
  const playNonce = Math.max((cfg.script?.playNonce ?? 0) + 1, Date.now());
  await db.saveDirectorConfig(SHORTS_PREVIEW_SCENE_ID, {
    mode: "script",
    script: { scriptId, fromClip, playNonce, record: false },
  });
  return playNonce;
}

/** Stop whatever the preview scene is playing — mode `off`; the runner stamps the play stopped. */
export async function stopPreviewPlay(db: AppDb): Promise<void> {
  await db.saveDirectorConfig(SHORTS_PREVIEW_SCENE_ID, { mode: "off" });
}
