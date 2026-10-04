/**
 * Manual one-shot — `yarn seed:crossword-scene [id] [name]`. Creates a
 * crossword channel (docs/crossword-mode-plan.md §10): a scene with surface
 * "crossword", the music bed on and chat on, plus its crossword config with
 * the host enabled. Defaults: id "crossword", name "Crossword".
 *
 * Idempotent: an existing scene is left alone (its look and settings are the
 * operator's), and the config is only written when the scene has none, so a
 * re-run never turns back on a host the operator switched off.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_CHAT_SETTINGS, DEFAULT_CONTROL_STATE, sceneSurface, slugifySceneId } from "@photonsurge/shared/control";

(async () => {
  const [rawId = "crossword", name = "Crossword"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const id = slugifySceneId(rawId);
  if (!id) throw new Error(`bad scene id "${rawId}"`);
  const db = await getAppDb();

  const existing = await db.getScene(id);
  if (existing) {
    const surface = sceneSurface(existing as { surface?: unknown });
    console.log(`scene ${id}: exists (surface ${surface}), left as it is`);
    if (surface !== "crossword") console.warn(`  warning: ${id} is a ${surface} channel, not a crossword one`);
  } else {
    await db.createScene(
      id,
      name,
      {
        ...DEFAULT_CONTROL_STATE,
        audio: { ...DEFAULT_AUDIO_SETTINGS, enabled: true },
        chat: { ...DEFAULT_CHAT_SETTINGS, enabled: true },
      },
      { surface: "crossword" },
    );
    console.log(`scene ${id}: created ("${name}", surface crossword, music bed on, chat on)`);
  }

  const cfg = await db.crosswordConfig.getByID(id);
  if (cfg.success && cfg.data) {
    console.log(`crossword config ${id}: exists, left as it is`);
  } else {
    await db.saveCrosswordConfig(id, { enabled: true });
    console.log(`crossword config ${id}: created (host enabled)`);
  }

  console.log(`done. Build a puzzle with \`yarn crossword:build ${id}\`.`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seed:crossword-scene failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
