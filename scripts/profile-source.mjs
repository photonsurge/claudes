#!/usr/bin/env node
// Read a profile frame back to source. profile-watch saves every chunk the
// profile touched under <profile-dir>/sources/; this prints the code around a
// `chunk:line:col` position as the report prints it (1-based, like DevTools).
//
//   node scripts/profile-source.mjs scratchpad/profile/<ts> 0.tf6pt1iu3-3.js:899:37543 [chars=240]
//
// Also names the enclosing function when it can find one (`function name(` /
// `name(...){` / `name=(...)=>` scanning back from the column).
import fs from "node:fs";
import path from "node:path";

const [dir, ref, charsArg] = process.argv.slice(2);
if (!dir || !ref) {
  console.error("usage: profile-source.mjs <profile-dir> <chunk:line:col> [chars]");
  process.exit(2);
}
const m = /^(.+?):(\d+):(\d+)$/.exec(ref);
if (!m) {
  console.error(`bad position: ${ref} (want chunk:line:col)`);
  process.exit(2);
}
const [, chunk, lineS, colS] = m;
const file = path.join(dir, "sources", chunk);
if (!fs.existsSync(file)) {
  console.error(`no ${file} — run profile-watch without --no-source`);
  process.exit(1);
}
const chars = Number(charsArg ?? 240);
const lines = fs.readFileSync(file, "utf8").split("\n");
const line = lines[Number(lineS) - 1] ?? "";
const col = Number(colS) - 1;
const before = line.slice(Math.max(0, col - chars), col);
const after = line.slice(col, col + chars);
// The nearest function-ish definition before the column, for a name.
const head = line.slice(Math.max(0, col - 4000), col);
const defs = [...head.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(|([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{|([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^()]*\)\s*=>/g)];
const last = defs.at(-1);
const name = last ? last[1] || last[2] || last[3] : null;
console.log(`${chunk}:${lineS}:${colS}${name ? `  (in ${name})` : ""}`);
console.log(`…${before}▶${after}…`);
