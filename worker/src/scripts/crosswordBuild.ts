/**
 * One-shot: build a crossword puzzle — the same code as the
 * `crossword.generate` job — and print the grid with its answers and the
 * approved pool's counts (docs/crossword-mode-plan.md §7.3).
 *
 *   yarn crossword:build                         (first crossword scene)
 *   yarn crossword:build crossword --seed 42
 *   yarn crossword:build crossword --dry         (print only, nothing saved)
 *
 * The puzzle is built from approved words and clues only and stored `ready`.
 * With no word bank imported it builds from the seed set; on a dev box,
 * CROSSWORD_ALLOW_UNAPPROVED=true lets it use pending words.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { entryCells, type CrosswordGenerateRequest, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { buildPuzzle, DEV_FAMILY_FRIENDLY_REASON } from "../crossword/build";
import { allowUnapprovedFromEnv } from "../crossword/pick";

function parseArgs(argv: string[]): { sceneId?: string; seed?: number; dry: boolean } {
  const out: { sceneId?: string; seed?: number; dry: boolean } = { dry: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") {
      out.seed = Number(value(i++, a));
      if (!Number.isFinite(out.seed)) throw new Error("--seed must be a number");
    } else if (a === "--dry") out.dry = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else if (!out.sceneId) out.sceneId = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/** The grid, answers filled in, "·" for a block. */
function gridLines(p: CrosswordPuzzle): string[] {
  const g = Array.from({ length: p.height }, () => Array<string>(p.width).fill("·"));
  for (const e of p.entries) entryCells(e).forEach((c, i) => (g[c.row][c.col] = e.answer[i]));
  return g.map((row) => row.join(" "));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = await getAppDb();
  const sceneId = args.sceneId ?? (await db.crosswordScenes())[0];
  if (!sceneId) throw new Error("no crossword scene: name one, or create one with `yarn seed:crossword-scene`");
  const req: CrosswordGenerateRequest = { sceneId, ...(args.seed != null ? { seed: args.seed } : {}) };
  const cfg = await db.getOrInitCrosswordConfig(sceneId);
  const pool = await db.crosswordBank.poolCounts();
  console.log(
    `\npool:   ${pool.words} approved words (${pool.puzzlesWithoutRepeat} puzzles without a repeat), ` +
      `${pool.ffWords} family friendly (${pool.ffPuzzlesWithoutRepeat}); target ${pool.targetWords}`,
  );
  console.log(`scene:  ${sceneId}   family friendly only: ${cfg.familyFriendlyOnly ? "on" : "off"}   min zipf: ${cfg.minZipf}`);
  if (allowUnapprovedFromEnv()) {
    console.log("        CROSSWORD_ALLOW_UNAPPROVED=true: pending words allowed (dev only)");
    if (cfg.familyFriendlyOnly) console.warn(`warning: ${DEV_FAMILY_FRIENDLY_REASON}`);
  }
  const t0 = Date.now();
  const r = await buildPuzzle(db, req, { dryRun: args.dry });
  const p = r.puzzle;

  console.log(`\n${args.dry ? "(dry run — not saved)" : `saved puzzle ${p.id} as ${p.status}`}`);
  console.log(
    `title:  ${p.title}   source: ${r.source}   seed: ${r.seed}   family friendly: ${p.familyFriendly ? "yes" : "no"}`,
  );
  console.log(
    `grid:   ${p.width}×${p.height}, ${p.entries.length} words from ${r.candidates} candidates ` +
      `(${r.available} available to this channel), ${r.crossings} crossings, ${r.attempts} attempts, ${Date.now() - t0} ms`,
  );
  console.log("");
  for (const line of gridLines(p)) console.log(`  ${line}`);
  for (const dir of ["across", "down"] as const) {
    console.log(`\n${dir.toUpperCase()}`);
    for (const e of p.entries.filter((x) => x.dir === dir)) {
      console.log(`  ${String(e.num).padStart(2)}  ${e.answer.padEnd(12)} ${e.clue}  [word ${e.wordId}, clue ${e.clueId}]`);
    }
  }
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("crossword:build failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
