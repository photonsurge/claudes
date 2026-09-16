#!/usr/bin/env node
/**
 * Attach to a live /watch page inside OBS (CEF remote debugging) and report
 * why the generative audio bed is silent. Read-only unless you pass --resume
 * or --restart. Zero dependencies (Node ≥ 22 global WebSocket), same attach
 * path as profile-watch.mjs.
 *
 *   node scripts/inspect-audio-bed.mjs http://localhost:9221 [--match watch] [--secs 5]
 *                                                             [--tail 400] [--resume] [--restart]
 *
 * --match   substring of the page URL to inspect (default "watch"; "" = every page)
 * --secs    how long to collect console output after the probe (default 5)
 * --tail    how many buffered console/log lines to print (default 400; the buffer
 *           replays the page's whole history, so the cold-start errors are at the top)
 * --resume  also call __auroraBed.resume() and re-probe (a suspended context)
 * --restart also stop()+start() the bed (restarts the ticker; same AudioContext)
 *
 * What the probe splits:
 *   ctx.state "suspended"           → CEF has no audio output for this page; the
 *                                     badge should be visible on the capture.
 *   "running" but advancedIn1s ≈ 0  → the context claims to run but its clock is
 *                                     stalled = the output device died under it.
 *   stepsAdvancedIn1s 0             → the Worker ticker is dead (scheduler stopped).
 *   errors climbing between probes  → the scheduler is throwing every step.
 *   busPeak fine, outputPeak −180   → master gain 0 (muted / volume 0 in ControlState).
 *   bus + output peaks both fine    → the PAGE is producing audio; the loss is in
 *                                     CEF→OBS capture (refresh the source / hard Provision)
 *                                     or in OBS routing (mixer / tracks / encoder).
 */

if (typeof WebSocket === "undefined") {
  console.error("Node ≥ 22 is required (global WebSocket). Current:", process.version);
  process.exit(1);
}

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--")) ?? "http://localhost:9221";
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const match = String(flag("match", "watch") === true ? "" : flag("match", "watch"));
const secs = +flag("secs", 5);
/** How many buffered console/log lines to print (oldest survive only if this is big enough). */
const tail = +flag("tail", 400);
const doResume = flag("resume", false) !== false;
const doRestart = flag("restart", false) !== false;

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Minimal CDP client (mirrors profile-watch.mjs) ──────────────────────────
function connect(wsUrl, openTimeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    const opened = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`websocket to ${wsUrl} did not open within ${openTimeoutMs / 1000}s`));
    }, openTimeoutMs);
    ws.onopen = () => {
      clearTimeout(opened);
      resolve({
        send: (method, params = {}, timeoutMs = 15_000) => {
          const p = new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej, method });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
          return withTimeout(p, timeoutMs, method);
        },
        on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
        close: () => ws.close(),
      });
    };
    ws.onerror = (e) => {
      clearTimeout(opened);
      reject(new Error(`websocket error connecting to ${wsUrl}: ${e.message ?? e}`));
    };
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

const evaluate = async (cdp, expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, 30_000);
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

// ── The probe (runs inside the page) ────────────────────────────────────────
const PROBE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  const out = {
    url: location.href,
    obsRender: !!window.obsstudio,
    visibility: document.visibilityState,
    pageAgeMin: +((Date.now() - performance.timeOrigin) / 60000).toFixed(1),
    heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
  };
  // What the server says this scene's audio settings are RIGHT NOW, to compare
  // with what the page acted on: a page that cold-started into a 5xx holds
  // DEFAULT_CONTROL_STATE (audio off) until an operator emit re-syncs it.
  try {
    const m = location.pathname.match(/\\/watch\\/?([^/]*)/);
    const id = m && m[1] ? decodeURIComponent(m[1]) : "default";
    const r = await fetch("/api/scenes/" + encodeURIComponent(id) + location.search, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    out.serverScene = r.ok ? { id, audio: (await r.json())?.audio ?? null } : { id, http: r.status };
  } catch (e) {
    out.serverScene = { error: String(e && e.message || e) };
  }
  const bed = window.__auroraBed;
  out.hasBed = !!bed;
  if (!bed) return { ...out, note: "no __auroraBed: BroadcastBed not mounted (page not on /watch, or crashed?)" };
  const st = bed.getState();
  out.bed = { ...st, section: st.section?.name, playing: bed.playing };
  const rig = bed.rig;
  if (!rig)
    return {
      ...out,
      rig: null,
      note: "start() never ran on this bed: the page has held audio.enabled=false for its whole life (a cold start into a 5xx defaults the scene state and is never retried; an operator emit on /control re-syncs it)",
    };
  const ctx = rig.ctx;
  const t0 = ctx.currentTime, s0 = bed.step;
  await sleep(1000);
  out.ctx = {
    state: ctx.state,
    sampleRate: ctx.sampleRate,
    currentTime: +ctx.currentTime.toFixed(1),
    advancedIn1s: +(ctx.currentTime - t0).toFixed(3),
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency,
    sinkId: ctx.sinkId === undefined ? undefined : String(ctx.sinkId),
  };
  out.sched = {
    step: bed.step,
    stepsAdvancedIn1s: bed.step - s0,
    aheadS: +(bed.nextNoteTime - ctx.currentTime).toFixed(3),
    lastResumeTryAgoS: bed.lastResumeTry ? +((Date.now() - bed.lastResumeTry) / 1000).toFixed(1) : null,
    tickerAttached: !!bed.stopTicker,
  };
  out.gains = {
    master: +rig.master.gain.value.toFixed(3),
    groups: Object.fromEntries(Object.entries(rig.groups ?? {}).map(([k, g]) => [k, +g.gain.value.toFixed(2)])),
    delayFb: +rig.delayFb.gain.value.toFixed(3),
  };
  // Output = the analyser after the master chain. Bus = a temporary tap before it,
  // so a muted master still shows whether the synths are making sound.
  const tap = ctx.createAnalyser();
  tap.fftSize = 1024;
  rig.bus.connect(tap);
  const read = (an) => {
    const buf = new Float32Array(an.fftSize);
    let peak = 0, nan = 0;
    for (let i = 0; i < 20; i++) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) { if (Number.isNaN(v)) nan++; else if (Math.abs(v) > peak) peak = Math.abs(v); }
    }
    return { peakDb: db(peak), nanSamples: nan };
  };
  const samples = [];
  for (let i = 0; i < 10; i++) { samples.push({ out: read(rig.analyser), bus: read(tap) }); await sleep(100); }
  rig.bus.disconnect(tap);
  out.levels = {
    outputPeakDb: Math.max(...samples.map((s) => s.out.peakDb)),
    busPeakDb: Math.max(...samples.map((s) => s.bus.peakDb)),
    nanSamples: samples.reduce((a, s) => a + s.out.nanSamples + s.bus.nanSamples, 0),
  };
  return out;
})()`;

const ACTIONS = `(async () => {
  const bed = window.__auroraBed;
  if (!bed) return "no bed";
  const done = [];
  if (${doResume}) { bed.resume(); done.push("resume()"); }
  if (${doRestart}) { bed.stop(); bed.start(); done.push("stop()+start()"); }
  await new Promise((r) => setTimeout(r, 1500));
  return done.join(" + ") || "(none)";
})()`;

// ── Target selection ────────────────────────────────────────────────────────
let pages;
if (/^wss?:/.test(target)) {
  pages = [{ title: "(explicit ws target)", url: target, webSocketDebuggerUrl: target }];
} else {
  const base = target.replace(/\/+$/, "");
  let targets;
  try {
    const res = await withTimeout(fetch(`${base}/json/list`), 5_000, "GET /json/list");
    targets = await res.json();
  } catch (e) {
    console.error(`cannot reach ${base}/json/list: ${e.cause?.message ?? e.message}`);
    console.error("is the ssh port-forward up, and was OBS launched with --remote-debugging-port?");
    process.exit(1);
  }
  const host = new URL(base).host;
  pages = targets
    .filter((t) => t.type === "page" && (t.url ?? "").includes(match))
    .map((t) => {
      const u = new URL(t.webSocketDebuggerUrl);
      u.host = host;
      return { ...t, webSocketDebuggerUrl: u.toString() };
    });
  if (!pages.length) {
    console.error(`no page target matching "${match}" at ${base}; targets:`);
    for (const t of targets) console.error(`  ${t.type}  ${t.url}`);
    process.exit(1);
  }
}

for (const p of pages) {
  console.log(`\n=== ${p.title || "(untitled)"}\n    ${p.url}`);
  let cdp;
  try {
    cdp = await connect(p.webSocketDebuggerUrl);
  } catch (e) {
    console.log(`  attach failed: ${e.message} (a dead target left by an OBS hard reset? try the next one)`);
    continue;
  }
  const lines = [];
  cdp.on("Runtime.consoleAPICalled", (m) => {
    if (["warning", "error", "assert"].includes(m.type))
      lines.push(`console.${m.type}: ${m.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  });
  cdp.on("Runtime.exceptionThrown", (m) => lines.push(`exception: ${m.exceptionDetails.exception?.description ?? m.exceptionDetails.text}`));
  cdp.on("Log.entryAdded", (m) => {
    const e = m.entry;
    if (!["warning", "error"].includes(e.level)) return;
    const age = e.timestamp ? ` (${((Date.now() - e.timestamp) / 60000).toFixed(1)} min ago)` : "";
    lines.push(`log.${e.level} [${e.source}]: ${e.text}${e.url ? "  ← " + e.url : ""}${age}`);
  });
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    console.log(JSON.stringify(await evaluate(cdp, PROBE), null, 2));
    if (doResume || doRestart) {
      console.log(`\n--- actions: ${await evaluate(cdp, ACTIONS)}`);
      console.log(JSON.stringify(await evaluate(cdp, PROBE), null, 2));
    }
    await sleep(secs * 1000);
    console.log(`\n--- console/log (buffered + last ${secs}s, warning level and above; last ${tail} of ${lines.length}):`);
    if (!lines.length) console.log("  (nothing)");
    for (const l of lines.slice(-tail)) console.log("  " + l);
  } catch (e) {
    console.log(`  probe failed: ${e.message}`);
  } finally {
    cdp.close();
  }
}
