#!/usr/bin/env node
/**
 * Trace WHO retains the biggest arrays in a V8 .heapsnapshot — the retainer path
 * names the exact holding code (which property / route / closure), so a leak is
 * identified instead of guessed.
 *
 * For the top-K biggest `array` nodes it walks UP the retainer graph (first
 * parent per node) collecting the edge (property) names, until it reaches a
 * distinctively-named holder or the depth limit. The property chain — e.g.
 * `coordinates <- geometry <- area <- info <- alerts <- <closure ...>` — tells
 * you whether the coordinates hang off `/api/alerts`'s `alerts`, the focus
 * bundle's `areaAlerts`, a module cache, etc.
 *
 * USAGE (roomy machine):
 *   node --max-old-space-size=12288 scripts/trace-heap-retainers.mjs <file.heapsnapshot> [topK=10] [maxDepth=18]
 */
import fs from "node:fs";

const file = process.argv[2];
const TOPK = Number(process.argv[3] || 10);
const MAXD = Number(process.argv[4] || 18);
if (!file) {
  console.error("usage: node --max-old-space-size=12288 trace-heap-retainers.mjs <file.heapsnapshot> [topK] [maxDepth]");
  process.exit(1);
}

const fmt = (n) => {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

console.error(`Reading ${file} (${fmt(fs.statSync(file).size)})…`);
const snap = JSON.parse(fs.readFileSync(file, "utf8"));
const meta = snap.snapshot.meta;

const nf = meta.node_fields, nStride = nf.length;
const nType = nf.indexOf("type"), nName = nf.indexOf("name"),
      nSelf = nf.indexOf("self_size"), nEdges = nf.indexOf("edge_count");
const nodeTypes = meta.node_types[0];

const ef = meta.edge_fields, eStride = ef.length;
const eType = ef.indexOf("type"), eName = ef.indexOf("name_or_index"), eTo = ef.indexOf("to_node");
const edgeTypes = meta.edge_types[0];

const nodes = snap.nodes, edges = snap.edges, strings = snap.strings;
const nodeCount = nodes.length / nStride;

const nodeLabel = (ord) => {
  const b = ord * nStride;
  const t = nodeTypes[nodes[b + nType]] ?? "?";
  const nm = strings[nodes[b + nName]] ?? "";
  if (t === "object" || t === "closure") return `${t === "closure" ? "fn " : ""}${nm || "(object)"}`;
  if (t.includes("string")) return "(string)";
  return nm ? `(${t} ${nm})` : `(${t})`;
};

// First-parent retainer map: iterate nodes in order (their edges are consecutive),
// record the first node that points at each child + the edge (property) name used.
console.error(`Indexing retainers over ${nodeCount.toLocaleString()} nodes…`);
const parent = new Int32Array(nodeCount).fill(-1);
const parentEdge = new Array(nodeCount);
let cursor = 0; // running edge index
for (let i = 0; i < nodeCount; i++) {
  const ec = nodes[i * nStride + nEdges];
  // Don't let GC roots / stack / the strong-root list claim parenthood — they're
  // iterated first and would shadow the real property chain we want to see.
  const fromType = nodeTypes[nodes[i * nStride + nType]];
  if (fromType !== "synthetic") {
    for (let e = 0; e < ec; e++) {
      const eb = (cursor + e) * eStride;
      const et = edgeTypes[edges[eb + eType]] ?? "";
      if (et === "weak") continue; // weak refs don't retain
      const child = edges[eb + eTo] / nStride;
      if (parent[child] === -1 && child !== i) {
        parent[child] = i;
        parentEdge[child] =
          et === "element" || et === "hidden" ? `[${edges[eb + eName]}]` : strings[edges[eb + eName]] ?? "?";
      }
    }
  }
  cursor += ec;
}

// Candidate targets: the biggest `array` nodes (coordinate backing stores show up
// here as "(array)" / "(object elements)").
const targets = [];
for (let i = 0; i < nodeCount; i++) {
  if (nodeTypes[nodes[i * nStride + nType]] === "array") targets.push(i);
}
targets.sort((a, b) => nodes[b * nStride + nSelf] - nodes[a * nStride + nSelf]);

console.log(`\n=== RETAINER PATHS for the ${TOPK} biggest arrays ===`);
console.log(`(read top-to-bottom = object outward to its GC root; the named holder is the leak)\n`);
for (const t of targets.slice(0, TOPK)) {
  console.log(`● ${fmt(nodes[t * nStride + nSelf])}  ${nodeLabel(t)}`);
  let cur = t, depth = 0;
  const seen = new Set();
  while (cur !== -1 && depth < MAXD && !seen.has(cur)) {
    seen.add(cur);
    const p = parent[cur];
    if (p === -1) { console.log(`    ↑ (GC root)`); break; }
    console.log(`    ↑ .${parentEdge[cur]}  in  ${nodeLabel(p)}`);
    cur = p;
    depth++;
  }
  console.log("");
}
