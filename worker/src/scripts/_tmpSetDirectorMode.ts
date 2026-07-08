/* TEMP diagnostic: set the default scene's director mode. Usage:
 *   yarn ts-node src/scripts/_tmpSetDirectorMode.ts auto|off */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";

(async () => {
  const mode = process.argv[2] === "auto" ? "auto" : "off";
  const db = await getAppDb();
  const cur = await db.getOrInitDirectorConfig("default");
  await db.saveDirectorConfig("default", { mode });
  const after = await db.getOrInitDirectorConfig("default");
  console.log(`set default mode ${cur.mode} -> ${after.mode}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
