/**
 * Manual one-shot — `yarn seed:crossword-scene [id] [name]`. Creates a
 * crossword channel (docs/crossword-mode-plan.md §10): the channel record
 * only — surface "crossword", the music bed on, chat on, and no YouTube
 * channel (that is picked on its settings page, and a crossword channel never
 * falls back to another). Its crossword config is left to the settings page,
 * which creates it with the defaults (host off) on first read. Defaults: id
 * "crossword", name "Crossword".
 *
 * Idempotent: an existing scene is left alone (its look and settings are the
 * operator's).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CONTROL_STATE,
  DEFAULT_YOUTUBE_SETTINGS,
  sceneSurface,
  slugifySceneId,
} from "@photonsurge/shared/control";

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
        youtube: { ...DEFAULT_YOUTUBE_SETTINGS, accountId: "" },
      },
      { surface: "crossword" },
    );
    console.log(`scene ${id}: created ("${name}", surface crossword, music bed on, chat on, no YouTube channel)`);
  }

  console.log(
    `done. Turn the host on and pick its YouTube channel on /admin/crosswords/channels/${id}; ` +
      `build a puzzle with \`yarn crossword:build ${id}\`.`,
  );
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seed:crossword-scene failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
