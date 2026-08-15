/**
 * Manual one-shot — `yarn seed:simple-scenes`. Creates the three "simple"
 * multi-view broadcast scenes (shared SIMPLE_SCENE_PRESETS) plus one DISABLED
 * StreamSlot each, leaving go-live as: register an OBS encoder per scene on
 * /admin/streams, then flip the slot switch.
 *
 * Existing scenes/slots are SKIPPED so a re-run never clobbers operator tweaks;
 * pass --force to re-apply the preset look to the scenes (slots are never
 * force-reset — their enabled state is live control).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { SIMPLE_SCENE_PRESETS } from "@photonsurge/shared/simple-scenes";

(async () => {
  const force = process.argv.includes("--force");
  const db = await getAppDb();

  for (const preset of SIMPLE_SCENE_PRESETS) {
    const existing = await db.getScene(preset.id);
    if (existing && !force) {
      console.log(`scene ${preset.id}: exists — skipped (use --force to re-apply the look)`);
    } else {
      // spinEpoch anchors the deterministic spin; stamp it at seed time.
      await db.createScene(preset.id, preset.name, { ...preset.seed, spinEpoch: Date.now() });
      console.log(`scene ${preset.id}: ${existing ? "re-applied" : "created"} (${preset.name})`);
    }

    const slot = await db.getStreamSlot(preset.slotId);
    if (slot) {
      console.log(`slot ${preset.slotId}: exists — skipped`);
    } else {
      await db.saveStreamSlot({
        id: preset.slotId,
        name: preset.slotName,
        sceneId: preset.id,
        title: preset.title,
        privacy: "public",
        enabled: false, // the /admin/streams switch is the go-live control
      });
      console.log(`slot ${preset.slotId}: created (disabled) — "${preset.title}"`);
    }
  }

  console.log("simple scenes seeded. Next: /admin/streams → register one OBS encoder per scene, flip the slots on.");
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedSimpleScenes fatal:", err);
  process.exit(1);
});
