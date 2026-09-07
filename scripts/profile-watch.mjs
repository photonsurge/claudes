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
  // Snippets for hot but mangled frames
  const mangled = selfSorted.filter(([k]) => /^(\(anonymous\)|[a-zA-Z_$]{1,3}) @/.test(k)).slice(0, 15);
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
  const report = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "report.txt"), report);
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ href, fps, dom, m0, m1, census }, null, 2));
  console.log(report);
  console.error(`\nsaved ${path.join(OUT, "profile.cpuprofile")} (load it in DevTools → Performance → ⬆) and report.txt`);
  cdp.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
