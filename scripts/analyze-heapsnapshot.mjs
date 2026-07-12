#!/usr/bin/env node
/**
 * Summarise a V8 .heapsnapshot the way Chrome DevTools' "Summary" view does,
 * but as pasteable text — so a leak can be diagnosed without shipping a
 * multi-GB file around or loading it into a browser.
 *
 * Groups every heap node by constructor (objects) / type (everything else) and
 * ranks the groups by total SELF size, then lists the biggest single objects.
 * For a real leak the dominant group / biggest objects at the top ARE the leak.
 *
 * Self-size (not retained size) is used deliberately: it needs no dominator-tree
 * traversal, so this stays cheap and runs in one pass. A leak of millions of
 * small objects shows as a huge aggregate; a leak of a few giant arrays/strings
 * shows in the "biggest single objects" list. Either way it points at the cause.
 *
 * USAGE (give Node enough heap to hold the snapshot — ~4-6x the .heapsnapshot
 * size; run on a roomy machine, NOT the 4GB box):
 *   node --max-old-space-size=12288 scripts/analyze-heapsnapshot.mjs <file.heapsnapshot>
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node --max-old-space-size=12288 analyze-heapsnapshot.mjs <file.heapsnapshot>");
  process.exit(1);
}

const fmt = (n) => {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

console.error(`Reading ${file} (${fmt(fs.statSync(file).size)} on disk)…`);
const snap = JSON.parse(fs.readFileSync(file, "utf8"));

const meta = snap.snapshot.meta;
const nodeFields = meta.node_fields;
const nodeTypes = meta.node_types[0]; // enum list for the "type" field
const stride = nodeFields.length;
const iType = nodeFields.indexOf("type");
const iName = nodeFields.indexOf("name");
const iSize = nodeFields.indexOf("self_size");

const nodes = snap.nodes;
const strings = snap.strings;
const nodeCount = nodes.length / stride;

/** group key -> { count, size } */
const groups = new Map();
/** running top-N biggest single nodes */
const biggest = []; // { key, size }
const BIGGEST_N = 25;
let minBiggest = 0;

let totalSelf = 0;

for (let n = 0; n < nodeCount; n++) {
  const base = n * stride;
  const typeName = nodeTypes[nodes[base + iType]] ?? "?";
  const size = nodes[base + iSize];
  totalSelf += size;

  const name = strings[nodes[base + iName]] ?? "";
  // Objects/closures group by constructor/function name; the rest by type.
  let key;
  if (typeName === "object") key = name || "(object)";
  else if (typeName === "closure") key = `closure ${name || "(anon)"}`;
  else if (typeName === "string" || typeName === "concatenated string" || typeName === "sliced string")
    key = "(string)";
  else key = `(${typeName})`;

  const g = groups.get(key);
  if (g) { g.count++; g.size += size; }
  else groups.set(key, { count: 1, size });

  if (size > minBiggest || biggest.length < BIGGEST_N) {
    biggest.push({ key: `${typeName}: ${name}`.slice(0, 70), size });
    if (biggest.length > BIGGEST_N) {
      biggest.sort((a, b) => b.size - a.size);
      biggest.length = BIGGEST_N;
      minBiggest = biggest[biggest.length - 1].size;
    }
  }
}

const ranked = [...groups.entries()].sort((a, b) => b[1].size - a[1].size);

console.log(`\n=== HEAP SNAPSHOT SUMMARY ===`);
console.log(`nodes: ${nodeCount.toLocaleString()}   total self-size: ${fmt(totalSelf)}\n`);

console.log(`TOP 30 GROUPS BY TOTAL SELF-SIZE  (constructor / type)`);
console.log(`${"total".padStart(10)}  ${"count".padStart(12)}  ${"avg".padStart(8)}  name`);
for (const [key, g] of ranked.slice(0, 30)) {
  console.log(
    `${fmt(g.size).padStart(10)}  ${g.count.toLocaleString().padStart(12)}  ${fmt(g.size / g.count).padStart(8)}  ${key}`,
  );
}

biggest.sort((a, b) => b.size - a.size);
console.log(`\nTOP ${BIGGEST_N} BIGGEST SINGLE OBJECTS`);
for (const b of biggest.slice(0, BIGGEST_N)) {
  console.log(`${fmt(b.size).padStart(10)}  ${b.key}`);
}
console.log("");
