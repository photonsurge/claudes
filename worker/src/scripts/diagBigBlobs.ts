/** TEMPORARY — what are the biggest blobs actually made of? */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";

async function main() {
  const db = await getAppDb();
  const { blobs } = await db.alertBlobs.list();

  const big = blobs
    .map((b: any) => ({
      id: b.id,
      hazard: b.hazard,
      sev: b.severityRank,
      members: b.memberIds?.length ?? 0,
      cities: b.cities?.length ?? 0,
      bbox: (b.bbox ?? []).map((n: number) => Math.round(n * 10) / 10),
      countries: [...new Set((b.cities ?? []).map((c: any) => c.cc))].sort(),
      builtAt: b.builtAt,
    }))
    .sort((a: any, z: any) => z.members - a.members)
    .slice(0, 12);

  console.log("=== biggest blobs by member count ===");
  for (const b of big) {
    console.log(
      `  ${b.hazard.padEnd(13)} sev${b.sev}  members=${String(b.members).padStart(4)}  cities=${String(b.cities).padStart(4)}  bbox=[${b.bbox.join(",")}]  countries=${b.countries.join(",") || "-"}`,
    );
  }

  // Which blob covers Paris?
  const paris = blobs.filter((b: any) =>
    (b.cities ?? []).some((c: any) => c.name === "Paris"),
  );
  console.log(`\n=== blobs covering Paris: ${paris.length} ===`);
  for (const b of paris) {
    const ccs = [...new Set((b.cities ?? []).map((c: any) => c.cc))].sort();
    console.log(
      `  ${b.hazard} sev${b.severityRank} members=${b.memberIds?.length} cities=${b.cities?.length} countries=${ccs.join(",")}`,
    );
  }
  process.exit(0);
}

main();
