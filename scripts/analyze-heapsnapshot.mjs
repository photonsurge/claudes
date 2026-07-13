#!/usr/bin/env node
/**
 * Summarise a V8 .heapsnapshot as pasteable text — so a leak can be diagnosed
 * without loading a multi-GB file into a browser.
 *
 *   ONE file : group every heap node by constructor (objects) / type (else),
 *              rank by total SELF size, then list the biggest single objects.
 *   TWO files: DIFF them — per-constructor growth (later minus earlier), ranked
 *              by how much each grew. For a leak the top grower IS the leak
 *              (e.g. "AlertRevision  +812 MB  +1,900,000"). This is the gold
 *              standard: baseline noise cancels out, only what accumulates shows.
 *
 * Self-size (not retained size) is used deliberately: no dominator-tree walk, so
 * this stays one cheap pass. A leak of millions of small objects shows as a huge
 * aggregate; a few giant arrays/strings show in "biggest single objects".
 *
 * USAGE (give Node enough heap for the snapshot — ~4-6x its on-disk size; run on
 * a roomy machine, NOT the 4GB box):
 *   node --max-old-space-size=12288 scripts/analyze-heapsnapshot.mjs <early.heapsnapshot> [<later.heapsnapshot>]
 */
import fs from "node:fs";

const files = process.argv.slice(2);
if (files.length < 1 || files.length > 2) {
  console.error("usage: node --max-old-space-size=12288 analyze-heapsnapshot.mjs <a.heapsnapshot> [<b.heapsnapshot>]");
  process.exit(1);
}

const fmt = (n) => {
  const neg = n < 0;
  let v = Math.abs(n);
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${neg ? "-" : ""}${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const sign = (n) => (n >= 0 ? `+${fmt(n)}` : fmt(n));

/** One-pass aggregate of a snapshot: constructor/type -> {count,size}, biggest[]. */
function aggregate(file) {
  console.error(`Reading ${file} (${fmt(fs.statSync(file).size)} on disk)…`);
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  const meta = snap.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[0];
  const stride = nodeFields.length;
  const iType = nodeFields.indexOf("type");
  const iName = nodeFields.indexOf("name");
  const iSize = nodeFields.indexOf("self_size");
  const nodes = snap.nodes;
  const strings = snap.strings;
  const count = nodes.length / stride;

  const groups = new Map();
  const biggest = [];
  let minBig = 0;
  let total = 0;

  for (let n = 0; n < count; n++) {
    const base = n * stride;
    const typeName = nodeTypes[nodes[base + iType]] ?? "?";
    const size = nodes[base + iSize];
    total += size;
    const name = strings[nodes[base + iName]] ?? "";
    let key;
    if (typeName === "object") key = name || "(object)";
    else if (typeName === "closure") key = `closure ${name || "(anon)"}`;
    else if (typeName.includes("string")) key = "(string)";
    else key = `(${typeName})`;
    const g = groups.get(key);
    if (g) { g.count++; g.size += size; } else groups.set(key, { count: 1, size });

    if (size > minBig || biggest.length < 25) {
      biggest.push({ key: `${typeName}: ${name}`.slice(0, 70), size });
      if (biggest.length > 25) {
        biggest.sort((a, b) => b.size - a.size);
        biggest.length = 25;
        minBig = biggest[24].size;
      }
    }
  }
  biggest.sort((a, b) => b.size - a.size);
  return { groups, biggest, total, nodeCount: count };
}

if (files.length === 1) {
  const a = aggregate(files[0]);
  const ranked = [...a.groups.entries()].sort((x, y) => y[1].size - x[1].size);
  console.log(`\n=== HEAP SUMMARY ===`);
  console.log(`nodes: ${a.nodeCount.toLocaleString()}   total self-size: ${fmt(a.total)}\n`);
  console.log(`TOP 30 GROUPS BY TOTAL SELF-SIZE`);
  console.log(`${"total".padStart(10)}  ${"count".padStart(12)}  ${"avg".padStart(8)}  name`);
  for (const [k, g] of ranked.slice(0, 30))
    console.log(`${fmt(g.size).padStart(10)}  ${g.count.toLocaleString().padStart(12)}  ${fmt(g.size / g.count).padStart(8)}  ${k}`);
  console.log(`\nTOP 25 BIGGEST SINGLE OBJECTS`);
  for (const b of a.biggest) console.log(`${fmt(b.size).padStart(10)}  ${b.key}`);
  console.log("");
} else {
  // DIFF: what grew from the earlier snapshot to the later one.
  const a = aggregate(files[0]); // earlier
  const b = aggregate(files[1]); // later
  const keys = new Set([...a.groups.keys(), ...b.groups.keys()]);
  const rows = [];
  for (const k of keys) {
    const ga = a.groups.get(k) ?? { count: 0, size: 0 };
    const gb = b.groups.get(k) ?? { count: 0, size: 0 };
    rows.push({ k, dSize: gb.size - ga.size, dCount: gb.count - ga.count, now: gb.size });
  }
  rows.sort((x, y) => y.dSize - x.dSize);
  console.log(`\n=== HEAP DIFF (later - earlier) ===`);
  console.log(`earlier total ${fmt(a.total)}  ->  later total ${fmt(b.total)}   (grew ${sign(b.total - a.total)})\n`);
  console.log(`TOP 30 GROUPS BY GROWTH  ${"Δsize".padStart(11)}  ${"Δcount".padStart(12)}  ${"now".padStart(9)}  name`);
  for (const r of rows.slice(0, 30))
    console.log(`${sign(r.dSize).padStart(37)}  ${(r.dCount >= 0 ? "+" : "") + r.dCount.toLocaleString()}`.padEnd(52) + `  ${fmt(r.now).padStart(9)}  ${r.k}`);
  console.log(`\n^ the top grower is the leak. Paste this whole block.`);
  console.log("");
}
