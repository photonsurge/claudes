#!/usr/bin/env node
/**
 * profile-watch.mjs — attach to a Chrome / CEF (OBS browser source) page over the
 * remote-debugging protocol, sample its main thread for N seconds and print the
 * Bottom-Up (self-time) table DevTools makes you dig for, plus renderer metrics.
 *
 *   node scripts/profile-watch.mjs http://localhost:9221            # picks the /watch page
 *   node scripts/profile-watch.mjs ws://localhost:9221/devtools/page/<id>
 *   node scripts/profile-watch.mjs http://localhost:9221 --seconds 30 --match seismic
 *
 * Options: --seconds N (20) · --interval µs (250) · --top N (35) · --match substr (/watch)
 *          --out dir (scratchpad/profile/<ts>) · --no-source (skip minified-code snippets)
 *          --raf-census (temporarily wraps requestAnimationFrame to count loops per frame)
 *          --trace [N] (after the profile, record an N s (8) Chrome timeline trace with layout/style
 *                      invalidation tracking: breaks "(program)" down by renderer event and names
 *                      the node + reason + JS caller of every layout invalidation / forced layout)
 *          --layers    (census of Chrome's composited layers with compositing reasons + DOM node —
 *                      Layerize cost scales with paint chunks × composited layers)
 *          --dom-census [N] (N s (5) MutationObserver: which parents are having nodes added/removed)
 *          --deck      (what deck.gl draws per frame: primitive layer count by id prefix, needs
 *                      the page's window.__godsDeck hook)
 *
 * Read-only against the page (Profiler / Performance / Runtime.evaluate). Needs Node ≥ 22
 * (global WebSocket); zero dependencies. Works with DevTools already attached.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--"));
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
if (!target) {
  console.error("usage: node scripts/profile-watch.mjs <http://host:port | ws://.../devtools/page/id> [--seconds 20]");
  process.exit(2);
}
const SECONDS = Number(opt("seconds", 20));
const INTERVAL_US = Number(opt("interval", 250));
const TOP = Number(opt("top", 35));
const MATCH = opt("match", "/watch");
const OUT = opt("out", path.join("scratchpad", "profile", new Date().toISOString().replace(/[:.]/g, "-")));
const WANT_SOURCE = !flag("no-source");
const RAF_CENSUS = flag("raf-census");
const LAYERS = flag("layers");
const DECK = flag("deck");
const DOM_CENSUS_SECONDS = (() => {
  const i = argv.indexOf("--dom-census");
  if (i === -1) return 0;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && !String(argv[i + 1] ?? "").startsWith("--") ? v : 5;
})();
const TRACE_SECONDS = (() => {
  const i = argv.indexOf("--trace");
  if (i === -1) return 0;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && !String(argv[i + 1] ?? "").startsWith("--") ? v : 8;
})();

if (typeof WebSocket === "undefined") {
  console.error("Node ≥ 22 is required (global WebSocket). Current:", process.version);
  process.exit(2);
}

// ── Target discovery ────────────────────────────────────────────────────────
async function resolveWsUrl(t) {
  if (t.startsWith("ws://") || t.startsWith("wss://")) return t;
  const base = t.replace(/\/+$/, "");
  const list = await (await fetch(`${base}/json`)).json();
  const pages = list.filter((x) => x.type === "page");
  const pick = pages.find((x) => x.url.includes(MATCH)) ?? pages[0];
  if (!pick) throw new Error(`no page targets at ${base}/json`);
  console.error(`target: ${pick.title || "(untitled)"} — ${pick.url}`);
  // CEF may advertise the remote host; keep the (forwarded) host:port we were given.
  const u = new URL(pick.webSocketDebuggerUrl);
  const b = new URL(base);
  u.host = b.host;
  return u.toString();
}

// ── Minimal CDP client ──────────────────────────────────────────────────────
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej, method });
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
        close: () => ws.close(),
      });
    ws.onerror = (e) => reject(new Error(`websocket error connecting to ${wsUrl}: ${e.message ?? e}`));
    ws.onmessage = (m) => {
      const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${method}: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      }
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (cdp, expression, awaitPromise = false) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
  return r.result.value;
};
const metricsOf = async (cdp) => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

// ── Profile analysis ────────────────────────────────────────────────────────
const base = (url) => (url ? url.split("/").pop().split("?")[0] : "");
const keyOf = (cf) => {
  const fn = cf.functionName || "(anonymous)";
  if (!cf.url) return fn; // (root) (program) (idle) (garbage collector) …
  return `${fn} @ ${base(cf.url)}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
};

function analyze(profile) {
  const byId = new Map();
  const parent = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const { samples, timeDeltas } = profile;
  const deltas = timeDeltas.slice();
  const sortedDeltas = deltas.filter((d) => d > 0).sort((a, b) => a - b);
  const median = sortedDeltas[Math.floor(sortedDeltas.length / 2)] ?? INTERVAL_US;
  const selfNode = new Map();
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    // timeDeltas[i+1] is the gap until the next sample → this sample's duration.
    const d = Math.max(0, i + 1 < deltas.length ? deltas[i + 1] : median);
    selfNode.set(samples[i], (selfNode.get(samples[i]) ?? 0) + d);
    total += d;
  }
  const self = new Map();
  const incl = new Map();
  const script = new Map();
  const special = { idle: 0, program: 0, gc: 0 };
  for (const [nid, us] of selfNode) {
    const n = byId.get(nid);
    const k = keyOf(n.callFrame);
    self.set(k, (self.get(k) ?? 0) + us);
    const fn = n.callFrame.functionName;
    if (fn === "(idle)") special.idle += us;
    else if (fn === "(program)") special.program += us;
    else if (fn === "(garbage collector)") special.gc += us;
    const s = n.callFrame.url ? base(n.callFrame.url) : fn;
    script.set(s, (script.get(s) ?? 0) + us);
    // inclusive: walk to root, dedupe keys along the chain (recursion)
    const seen = new Set();
    let cur = nid;
    while (cur !== undefined) {
      const kk = keyOf(byId.get(cur).callFrame);
      if (!seen.has(kk)) {
        seen.add(kk);
        incl.set(kk, (incl.get(kk) ?? 0) + us);
      }
      cur = parent.get(cur);
    }
  }
  return { total, special, self, incl, script, byId };
}

const WATCH = /^(_onRenderFrame|redraw|_drawLayers|drawLayers|renderLayers|updateLayers|setLayers|_updateLayers|_updateSublayersRecursively|_updateLayer|_transferState|_diffProps|_update|updateState|_postUpdate|_updateAttributes|_updatePalette|_createMesh|_updateFeatures|update|updateBuffer|_updateAttribute|setData|tesselate|tessellate|earcut|project|getViewports|draw|render|onHover|flushSync|performWorkUntilDeadline|commitRoot|performConcurrentWorkOnRoot|animationFrame|_animationFrame|tick|loop|step|commitLayers)$/;

function fmt(us) {
  return (us / 1000).toFixed(1).padStart(8);
}
function pct(us, of) {
  return (of ? (100 * us) / of : 0).toFixed(1).padStart(5) + "%";
}

async function snippetFetcher(cdp) {
  if (!WANT_SOURCE) return async () => null;
  const cache = new Map();
  try {
    await cdp.send("Debugger.enable");
  } catch {
    return async () => null;
  }
  return async (cf) => {
    if (!cf.url || !cf.scriptId) return null;
    if (!cache.has(cf.scriptId)) {
      try {
        const { scriptSource } = await cdp.send("Debugger.getScriptSource", { scriptId: cf.scriptId });
        cache.set(cf.scriptId, scriptSource.split("\n"));
      } catch {
        cache.set(cf.scriptId, null);
      }
    }
    const lines = cache.get(cf.scriptId);
    if (!lines) return null;
    const line = lines[cf.lineNumber] ?? "";
    const c = cf.columnNumber;
    return line
      .slice(Math.max(0, c - 110), c + 150)
      .replace(/\s+/g, " ");
  };
}

// ── Timeline trace (who dirties layout / what is "(program)") ───────────────
// Recorded AFTER the CPU profile so neither skews the other. Chrome's timeline
// categories carry every Layout / style-recalc event with its duration, the JS
// stack that FORCED it (if any), and — with invalidation tracking on — the node
// + reason for every layout/style invalidation. That's the answer to "why is
// layout running every frame" that a CPU profile can't give.
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-devtools.timeline.stack",
  "blink.user_timing",
];

async function recordTrace(cdp, seconds) {
  const events = [];
  cdp.on("Tracing.dataCollected", (p) => {
    for (const e of p.value ?? []) events.push(e);
  });
  let done;
  const complete = new Promise((r) => (done = r));
  cdp.on("Tracing.tracingComplete", () => done());
  await cdp.send("Tracing.start", {
    traceConfig: { recordMode: "recordContinuously", includedCategories: TRACE_CATEGORIES },
    transferMode: "ReportEvents",
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await cdp.send("Tracing.end");
  await complete;
  return events;
}

const frameOf = (f) =>
  f ? `${f.functionName || "(anonymous)"} @ ${(f.url || "").split("/").pop().split("?")[0]}:${(f.lineNumber ?? 0) + 1}:${(f.columnNumber ?? 0) + 1}` : "(no stack)";
/** First frame that isn't inside a well-known library, else the top frame. */
const callerOf = (stack) => {
  if (!stack || !stack.length) return "(no stack — not forced by JS)";
  return frameOf(stack[0]);
};

function analyzeTrace(events) {
  // The renderer main thread is the one firing animation frames / recalculating
  // style (compositor + browser threads only ever show RunTask).
  const score = new Map();
  for (const e of events) {
    const w =
      e.name === "FireAnimationFrame" || e.name === "UpdateLayoutTree" || e.name === "Layout"
        ? 1000
        : e.name === "RunTask"
          ? 1
          : 0;
    if (!w) continue;
    const k = `${e.pid}:${e.tid}`;
    score.set(k, (score.get(k) ?? 0) + w);
  }
  const main = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ev = events
    .filter((e) => `${e.pid}:${e.tid}` === main && e.ph !== "M" && typeof e.ts === "number" && e.ts > 0)
    .sort((a, b) => a.ts - b.ts);
  let t0 = Infinity;
  let t1 = -Infinity;
  const dur = new Map();
  const count = new Map();
  const open = new Map();
  const layouts = [];
  const recalcs = [];
  const layoutInval = new Map();
  const layoutInvalCallers = new Map();
  const styleInval = new Map();
  const styleInvalCallers = new Map();
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const add = (name, d, begin) => {
    bump(dur, name, d);
    bump(count, name);
    if (name === "Layout") {
      const bd = begin.args?.beginData ?? {};
      layouts.push({ d, stack: bd.stackTrace, dirty: bd.dirtyObjects ?? 0, total: bd.totalObjects ?? 0, partial: !!bd.partialLayout });
    } else if (name === "UpdateLayoutTree") {
      const bd = begin.args?.beginData ?? {};
      recalcs.push({ d, stack: bd.stackTrace, n: begin.args?.elementCount ?? 0 });
    }
  };
  for (const e of ev) {
    if (typeof e.ts === "number") {
      if (e.ts < t0) t0 = e.ts;
      const end = e.ts + (e.dur ?? 0);
      if (end > t1) t1 = end;
    }
    if (e.ph === "X") add(e.name, e.dur ?? 0, e);
    else if (e.ph === "B") {
      if (!open.has(e.name)) open.set(e.name, []);
      open.get(e.name).push(e);
    } else if (e.ph === "E") {
      const b = open.get(e.name)?.pop();
      if (b) add(e.name, e.ts - b.ts, b);
    } else if (e.ph === "I" || e.ph === "i" || e.ph === "R" || e.ph === "n") {
      const d = e.args?.data ?? {};
      if (e.name === "LayoutInvalidationTracking") {
        bump(layoutInval, `${d.reason ?? "?"} · ${(d.nodeName ?? "?").slice(0, 70)}`);
        bump(layoutInvalCallers, callerOf(d.stackTrace));
      } else if (
        e.name === "StyleRecalcInvalidationTracking" ||
        e.name === "ScheduleStyleInvalidationTracking" ||
        e.name === "StyleInvalidatorInvalidationTracking"
      ) {
        const what = d.changedClass ?? d.changedId ?? d.changedAttribute ?? d.changedPseudo ?? d.extraData ?? "";
        bump(styleInval, `${e.name.replace("InvalidationTracking", "")} · ${d.reason ?? "?"}${what ? ` (${what})` : ""} · ${(d.nodeName ?? "?").slice(0, 60)}`);
        bump(styleInvalCallers, callerOf(d.stackTrace));
      }
    }
  }
  const wallMs = (t1 - t0) / 1000;
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const ms = (us) => (us / 1000).toFixed(1).padStart(8);
  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`## Timeline trace — main thread ${main ?? "?"}, ${wallMs.toFixed(0)} ms of wall time`);
  p(`### Main-thread time by event (inclusive; nested events overlap)`);
  p(`  total ms   count  event`);
  for (const [name, us] of top(dur, 22)) p(`${ms(us)}  ${String(count.get(name)).padStart(6)}  ${name}`);
  p();
  const lTotal = layouts.reduce((a, l) => a + l.d, 0);
  const forced = layouts.filter((l) => l.stack && l.stack.length);
  p(`### Layout: ${layouts.length}× · ${(lTotal / 1000).toFixed(0)} ms · avg ${layouts.length ? (lTotal / layouts.length / 1000).toFixed(1) : "0"} ms · avg dirty/total objects ${layouts.length ? Math.round(layouts.reduce((a, l) => a + l.dirty, 0) / layouts.length) : 0}/${layouts.length ? Math.round(layouts.reduce((a, l) => a + l.total, 0) / layouts.length) : 0}`);
  p(`  forced synchronously by JS: ${forced.length}× (${(forced.reduce((a, l) => a + l.d, 0) / 1000).toFixed(0)} ms)`);
  const forcedBy = new Map();
  for (const l of forced) bump(forcedBy, callerOf(l.stack), l.d);
  for (const [k, us] of top(forcedBy, 8)) p(`${ms(us)}  ${k}`);
  p();
  p(`### Who invalidated layout (LayoutInvalidationTracking) — reason · node`);
  for (const [k, n] of top(layoutInval, 15)) p(`${String(n).padStart(8)}×  ${k}`);
  p(`  … by JS caller:`);
  for (const [k, n] of top(layoutInvalCallers, 8)) p(`${String(n).padStart(8)}×  ${k}`);
  p();
  const rTotal = recalcs.reduce((a, r) => a + r.d, 0);
  const rForced = recalcs.filter((r) => r.stack && r.stack.length);
  p(`### Style recalc (UpdateLayoutTree): ${recalcs.length}× · ${(rTotal / 1000).toFixed(0)} ms · forced by JS ${rForced.length}×`);
  const rBy = new Map();
  for (const r of rForced) bump(rBy, callerOf(r.stack), r.d);
  for (const [k, us] of top(rBy, 6)) p(`${ms(us)}  ${k}`);
  p(`  top style invalidations:`);
  for (const [k, n] of top(styleInval, 12)) p(`${String(n).padStart(8)}×  ${k}`);
  p(`  … by JS caller:`);
  for (const [k, n] of top(styleInvalCallers, 8)) p(`${String(n).padStart(8)}×  ${k}`);
  return lines.join("\n");
}

// ── Composited-layer census (why is Layerize expensive?) ────────────────────
// Every cc layer Chrome keeps for the page, with Blink's own compositing
// reasons and the DOM node behind it. Layerize / overlap testing scales with
// (paint chunks × composited layers), so this is the list to shrink.
async function layerCensus(cdp) {
  await cdp.send("DOM.enable");
  await cdp.send("DOM.getDocument", { depth: 0 });
  const layers = await new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 4000);
    cdp.on("LayerTree.layerTreeDidChange", (p) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(p.layers ?? []);
    });
    cdp.send("LayerTree.enable").catch(() => {
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve(null);
      }
    });
  });
  const lines = [];
  const p = (s = "") => lines.push(s);
  if (!layers) {
    p("## Layer census: LayerTree domain unavailable / no tree within 4s");
    return lines.join("\n");
  }
  const rows = [];
  const reasonCount = new Map();
  for (const l of layers) {
    let reasons = [];
    try {
      const r = await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId });
      reasons = r.compositingReasons ?? r.compositingReasonIds ?? [];
    } catch {}
    for (const r of reasons) reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1);
    let node = "";
    if (l.backendNodeId) {
      try {
        const { node: n } = await cdp.send("DOM.describeNode", { backendNodeId: l.backendNodeId });
        const attrs = n.attributes ?? [];
        const get = (k) => {
          const i = attrs.indexOf(k);
          return i === -1 ? "" : attrs[i + 1];
        };
        const style = get("style");
        node = `${n.nodeName}${get("id") ? "#" + get("id") : ""}${get("class") ? "." + get("class").split(" ").join(".") : ""}${style ? ` style="${style.slice(0, 70)}${style.length > 70 ? "…" : ""}"` : ""}`;
      } catch {}
    }
    rows.push({ id: l.layerId, w: Math.round(l.width), h: Math.round(l.height), paints: l.paintCount ?? 0, drawsContent: !!l.drawsContent, reasons, node });
  }
  try {
    await cdp.send("LayerTree.disable");
  } catch {}
  const drawing = rows.filter((r) => r.drawsContent);
  p(`## Layer census: ${rows.length} cc layers (${drawing.length} draw content)`);
  p(`  by compositing reason:`);
  for (const [r, n] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) p(`${String(n).padStart(6)}×  ${r}`);
  p(`  largest content layers (w×h · paints · reasons · node):`);
  for (const r of drawing.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 30)) {
    p(`  ${String(r.w).padStart(5)}×${String(r.h).padEnd(5)} ${String(r.paints).padStart(6)}  ${r.reasons.join(",") || "-"}  ${r.node}`);
  }
  return lines.join("\n");
}

// ── DOM churn census (who is remounting nodes?) ─────────────────────────────
// A MutationObserver for a few seconds, grouping added/removed nodes by the
// nearest identifiable ancestor chain so a remounting list shows up by name.
async function domCensus(cdp, seconds) {
  const r = await evaluate(
    cdp,
    `new Promise((res) => {
      const sig = (el) => { const parts = []; let n = el; for (let i = 0; i < 6 && n && n.nodeType === 1; i++) {
          let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; if (n.className && typeof n.className === 'string') s += '.' + n.className.trim().split(/\\s+/).slice(0,2).join('.');
          for (const a of n.attributes) if (a.name.startsWith('data-') && a.name !== 'data-reactroot') { s += '[' + a.name + (a.value ? '=' + a.value.slice(0,20) : '') + ']'; break; }
          parts.unshift(s); n = n.parentElement; } return parts.join(' > '); };
      const added = new Map(); const removed = new Map(); let nAdded = 0, nRemoved = 0; let text = new Map();
      const count = (m, k, n) => m.set(k, (m.get(k) ?? 0) + n);
      const size = (node) => node.nodeType === 1 ? 1 + node.getElementsByTagName('*').length : 1;
      const mo = new MutationObserver((muts) => { for (const m of muts) {
          if (m.type === 'childList') { const k = sig(m.target);
            for (const n of m.addedNodes) { const c = size(n); nAdded += c; count(added, k, c); if (n.textContent) count(text, k + ' :: "' + n.textContent.trim().slice(0, 40) + '"', 1); }
            for (const n of m.removedNodes) { const c = size(n); nRemoved += c; count(removed, k, c); } }
          else if (m.type === 'characterData') { count(text, sig(m.target.parentElement) + ' :: (text)', 1); } } });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      setTimeout(() => { mo.disconnect();
        const top = (m) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
        res({ nAdded, nRemoved, added: top(added), removed: top(removed), text: top(text) }); }, ${seconds * 1000});
    })`,
    true,
  );
  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`## DOM churn census (${seconds}s): ${r.nAdded} nodes added, ${r.nRemoved} removed (${(r.nAdded / seconds).toFixed(0)}/s, ${(r.nRemoved / seconds).toFixed(0)}/s)`);
  p(`  added, by parent (subtree node counts):`);
  for (const [k, n] of r.added) p(`${String(n).padStart(7)}  ${k}`);
  p(`  removed, by parent:`);
  for (const [k, n] of r.removed) p(`${String(n).padStart(7)}  ${k}`);
  p(`  most frequent inserted content / text changes:`);
  for (const [k, n] of r.text) p(`${String(n).padStart(7)}  ${k}`);
  return lines.join("\n");
}


// ── deck.gl draw census (how many models are drawn per frame?) ──────────────
async function deckCensus(cdp) {
  const r = await evaluate(
    cdp,
    `(() => { const d = window.__godsDeck; if (!d) return null;
      const all = d.layerManager.getLayers();
      const prim = all.filter((l) => !l.isComposite);
      const drawn = prim.filter((l) => l.props.visible !== false);
      const byPrefix = new Map();
      for (const l of drawn) { const k = String(l.id).replace(/[-_ ]?[0-9a-f]{4,}.*$/i, '').replace(/[-_]?\d+.*$/, '') || l.id;
        byPrefix.set(k, (byPrefix.get(k) ?? 0) + 1); }
      return { top: d.props.layers.length, all: all.length, primitive: prim.length, drawn: drawn.length,
        groups: [...byPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40) }; })()`,
  );
  const lines = [];
  const p = (s = "") => lines.push(s);
  if (!r) {
    p("## deck census: window.__godsDeck not present (older build?)");
    return lines.join("\n");
  }
  p(`## deck census: ${r.top} top-level layers → ${r.all} incl. sublayers → ${r.primitive} primitive, ${r.drawn} drawn (visible) per frame`);
  for (const [k, n] of r.groups) p(`${String(n).padStart(6)}×  ${k}`);
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const wsUrl = await resolveWsUrl(target);
  const cdp = await connect(wsUrl);
  fs.mkdirSync(OUT, { recursive: true });
  const href = await evaluate(cdp, "location.href");
  console.error(`attached: ${href}`);

  let censusPromise = null;
  if (RAF_CENSUS) {
    censusPromise = evaluate(
      cdp,
      `new Promise((res) => {
        const orig = window.requestAnimationFrame;
        const perFrame = new Map(); const srcs = new Map(); let frames = 0;
        window.requestAnimationFrame = (fn) => { const s = String(fn).slice(0, 90).replace(/\\s+/g,' ');
          srcs.set(s, (srcs.get(s) ?? 0) + 1);
          return orig.call(window, (t) => { perFrame.set(t, (perFrame.get(t) ?? 0) + 1); fn(t); }); };
        const t0 = performance.now();
        const stop = () => { window.requestAnimationFrame = orig;
          const counts = [...perFrame.values()]; const cbPerFrame = counts.reduce((a,b)=>a+b,0) / Math.max(1, counts.length);
          res({ frames: counts.length, callbacksPerFrame: +cbPerFrame.toFixed(2),
                loops: [...srcs.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15) }); };
        setTimeout(stop, ${Math.min(SECONDS, 5) * 1000});
      })`,
      true,
    );
  }

  await cdp.send("Performance.enable");
  const m0 = await metricsOf(cdp);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: INTERVAL_US });
  const fpsPromise = evaluate(
    cdp,
    `new Promise((res) => { let n = 0; const gaps = []; let last = performance.now(); const t0 = last;
       const loop = (t) => { n++; gaps.push(t - last); last = t;
         if (t - t0 < ${SECONDS * 1000}) requestAnimationFrame(loop); else { gaps.sort((a,b)=>a-b);
           res({ fps: +((n * 1000) / (t - t0)).toFixed(1), frameMsP50: +gaps[Math.floor(gaps.length*0.5)].toFixed(1),
                 frameMsP95: +gaps[Math.floor(gaps.length*0.95)].toFixed(1), frameMsMax: +gaps[gaps.length-1].toFixed(1) }); } };
       requestAnimationFrame(loop); })`,
    true,
  );
  await cdp.send("Profiler.start");
  console.error(`sampling main thread for ${SECONDS}s …`);
  await sleep(SECONDS * 1000);
  const { profile } = await cdp.send("Profiler.stop");
  const m1 = await metricsOf(cdp);
  const fps = await fpsPromise;
  const census = censusPromise ? await censusPromise : null;
  fs.writeFileSync(path.join(OUT, "profile.cpuprofile"), JSON.stringify(profile));

  const dom = await evaluate(
    cdp,
    `({ nodes: document.getElementsByTagName('*').length,
        willChange: document.querySelectorAll('[style*="will-change"]').length,
        canvases: document.querySelectorAll('canvas').length,
        gpu: (() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
          const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { return '?'; } })() })`,
  );

  const a = analyze(profile);
  const busy = a.total - a.special.idle;
  const snippet = await snippetFetcher(cdp);
  const lines = [];
  const p = (s = "") => lines.push(s);
  p(`# profile-watch — ${href}`);
  p(`sampled ${SECONDS}s @ ${INTERVAL_US}µs · main thread busy ${pct(busy, a.total)} (idle ${fmt(a.special.idle)}ms, GC ${fmt(a.special.gc)}ms, (program) ${fmt(a.special.program)}ms)`);
  p(`rAF: ${fps.fps} fps · frame gap p50 ${fps.frameMsP50}ms · p95 ${fps.frameMsP95}ms · max ${fps.frameMsMax}ms`);
  const d = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
  p(`renderer: RecalcStyle ${d("RecalcStyleCount")}× (${(d("RecalcStyleDuration") * 1000).toFixed(0)}ms) · Layout ${d("LayoutCount")}× (${(d("LayoutDuration") * 1000).toFixed(0)}ms) · Script ${(d("ScriptDuration") * 1000).toFixed(0)}ms · Task ${(d("TaskDuration") * 1000).toFixed(0)}ms`);
  p(`DOM: ${dom.nodes} nodes · ${dom.willChange} inline will-change elements · ${dom.canvases} canvases · JS heap ${(m1.JSHeapUsedSize / 1048576).toFixed(0)}MB · GPU: ${dom.gpu}`);
  if (census) {
    p(`rAF census (${census.frames} frames): ${census.callbacksPerFrame} callbacks/frame`);
    for (const [src, n] of census.loops) p(`   ${String(n).padStart(5)}×  ${src}`);
  }
  p();
  p(`## Bottom-Up — top ${TOP} by SELF time (% of busy main-thread time)`);
  p(`   self ms   %busy  function @ script:line:col`);
  const selfSorted = [...a.self.entries()].filter(([k]) => !/^\((idle|root)\)$/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, TOP);
  for (const [k, us] of selfSorted) p(`${fmt(us)}  ${pct(us, busy)}  ${k}`);
  p();
  p(`## Self time by script`);
  for (const [s, us] of [...a.script.entries()].filter(([s]) => s !== "(idle)" && s !== "(root)").sort((x, y) => y[1] - x[1]).slice(0, 12))
    p(`${fmt(us)}  ${pct(us, busy)}  ${s || "(native)"}`);
  p();
  p(`## Inclusive (subtree) time — deck.gl / WeatherLayers / React / rAF entry points`);
  const inclSorted = [...a.incl.entries()].filter(([k]) => WATCH.test(k.split(" @ ")[0])).sort((x, y) => y[1] - x[1]).slice(0, 30);
  for (const [k, us] of inclSorted) p(`${fmt(us)}  ${pct(us, busy)}  ${k}`);
  // Snippets for hot but mangled frames — plus the heaviest `draw`/`updateState`
  // methods by inclusive time, so a deck.gl layer class can be told apart from
  // its chunk name alone.
  const drawish = inclSorted.filter(([k]) => /^(draw|updateState|renderLayers) @/.test(k)).slice(0, 8);
  const mangled = [...selfSorted.filter(([k]) => /^(\(anonymous\)|[a-zA-Z_$]{1,3}) @/.test(k)).slice(0, 15), ...drawish];
  if (mangled.length && WANT_SOURCE) {
    p();
    p(`## What the mangled hot frames are (source around the sampled position)`);
    for (const [k] of mangled) {
      const node = profile.nodes.find((n) => keyOf(n.callFrame) === k);
      const s = node ? await snippet(node.callFrame) : null;
      if (s) p(`- ${k}\n    …${s}…`);
    }
  }
  try {
    if (WANT_SOURCE) await cdp.send("Debugger.disable");
  } catch {}
  if (DECK) {
    try {
      p();
      p(await deckCensus(cdp));
    } catch (e) {
      p(`## deck census failed: ${e.message || e}`);
    }
  }
  if (LAYERS) {
    console.error("taking a composited-layer census …");
    try {
      p();
      p(await layerCensus(cdp));
    } catch (e) {
      p(`## Layer census failed: ${e.message || e}`);
    }
  }
  if (DOM_CENSUS_SECONDS > 0) {
    console.error(`watching DOM mutations for ${DOM_CENSUS_SECONDS}s …`);
    try {
      p();
      p(await domCensus(cdp, DOM_CENSUS_SECONDS));
    } catch (e) {
      p(`## DOM census failed: ${e.message || e}`);
    }
  }
  if (TRACE_SECONDS > 0) {
    console.error(`recording a ${TRACE_SECONDS}s timeline trace …`);
    try {
      const events = await recordTrace(cdp, TRACE_SECONDS);
      fs.writeFileSync(path.join(OUT, "trace.json"), JSON.stringify({ traceEvents: events }));
      p();
      p(analyzeTrace(events));
    } catch (e) {
      p();
      p(`## Timeline trace failed: ${e.message || e}`);
    }
  }
  const report = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "report.txt"), report);
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ href, fps, dom, m0, m1, census }, null, 2));
  console.log(report);
  console.error(`\nsaved ${path.join(OUT, "profile.cpuprofile")} (load it in DevTools → Performance → ⬆)${TRACE_SECONDS > 0 ? ", trace.json (same panel)" : ""} and report.txt`);
  cdp.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
