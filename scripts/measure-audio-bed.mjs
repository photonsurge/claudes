#!/usr/bin/env node
/**
 * Drive the real AuroraBed engine (public/src/lib/audio/engine.ts) in headless
 * Chromium and report what reaches the output: peak level, share of samples
 * at/over full scale (= hard clipping at the sink), RMS, per-second peaks.
 * The ear-ball tool for the master chain — run it before touching levels.
 *
 *   node scripts/measure-audio-bed.mjs [--mode breaks|chill|lounge|deep|minimal|auto]
 *                                      [--secs 20] [--vol 1] [--solo atmos] [--trace 1]
 * --trace 1 prints every phrase change (role · bars · progression · key).
 * --weather 'wind=20,rain=8,temp=30,kp=8' applies a weather mood (see weather.ts).
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "public", "package.json"));
const ts = require("typescript");
const { chromium } = require("playwright");

const opts = { mode: "breaks", secs: "20", vol: "1", solo: "", trace: "0", weather: "" };
for (let i = 2; i < process.argv.length; i += 2) opts[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];

const transpile = (file) =>
  ts
    .transpileModule(readFileSync(path.join(root, "public/src/lib/audio", file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.js"');
const files = {
  "/": {
    type: "text/html",
    body: '<!doctype html><script type="module">import { AuroraBed } from "./engine.js"; import { moodFrom } from "./weather.js"; window.AuroraBed = AuroraBed; window.moodFrom = moodFrom;</script>',
  },
};
for (const f of readdirSync(path.join(root, "public/src/lib/audio")))
  if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files["/" + f.replace(/\.ts$/, ".js")] = { type: "text/javascript", body: transpile(f) };

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.route("http://bed.local/**", (route) => {
  const f = files[new URL(route.request().url()).pathname];
  return f ? route.fulfill({ status: 200, contentType: f.type, body: f.body }) : route.fulfill({ status: 404 });
});
await page.goto("http://bed.local/");
await page.waitForFunction(() => !!window.AuroraBed);

const res = await page.evaluate(
  async ({ mode, secs, solo, vol, doTrace, weather }) => {
    const bed = new window.AuroraBed();
    bed.start();
    bed.setMode(mode);
    bed.setMasterVolume(vol);
    if (weather) bed.setWeather(window.moodFrom(Object.fromEntries(weather.split(",").map((kv) => { const [k, v] = kv.split("="); return [k, +v]; }))));
    if (solo) for (const s of ["keys", "pad", "lead", "bass", "kick", "hat", "perc", "atmos"]) bed.setStem(s, s === solo);
    const ctx = bed.rig.ctx;
    const an = bed.rig.analyser; // last node before ctx.destination
    await new Promise((r) => setTimeout(r, 300));
    const t0 = ctx.currentTime;
    const buf = new Float32Array(an.fftSize);
    let peak = 0, n = 0, clipped = 0, sumSq = 0;
    const perSec = new Map();
    const trace = [];
    let lastPhrase = "";
    let lastTrack = "";
    await new Promise((done) => {
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const sec = Math.floor(ctx.currentTime - t0);
        let sp = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
          if (a > sp) sp = a;
          if (a >= 0.999) clipped++;
          sumSq += a * a;
          n++;
        }
        perSec.set(sec, Math.max(perSec.get(sec) ?? 0, sp));
        const cur = bed.getState();
        if (cur.track !== lastTrack) { lastTrack = cur.track; trace.push(`${sec}s ♪ ${cur.track} · ${cur.key}`); }
        if (cur.phrase !== lastPhrase) { lastPhrase = cur.phrase; trace.push(`${sec}s ${cur.section.name} → ${cur.phrase}`); }
        if (ctx.currentTime - t0 >= secs) {
          clearInterval(iv);
          done();
        }
      }, 10);
    });
    const st = bed.getState();
    const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
    return {
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      mode,
      vol,
      solo: solo || null,
      energy: +st.energy.toFixed(2),
      section: st.section.name,
      phrase: st.phrase,
      dropped: st.dropped,
      peakDb: db(peak),
      clippedPct: +((clipped / n) * 100).toFixed(3),
      rmsDb: +(10 * Math.log10(sumSq / n)).toFixed(1),
      perSecPeakDb: [...perSec.values()].map(db),
      trace: doTrace ? trace : undefined,
    };
  },
  { mode: opts.mode, secs: +opts.secs, solo: opts.solo, vol: +opts.vol, doTrace: opts.trace === "1", weather: opts.weather },
);
await browser.close();
const { trace, ...rest } = res;
console.log(JSON.stringify(rest));
if (trace) for (const line of trace) console.log("  " + line);
console.log(
  `${res.mode}${res.solo ? " (solo " + res.solo + ")" : ""} @ vol ${res.vol}: peak ${res.peakDb} dBFS, rms ${res.rmsDb} dB, clipped ${res.clippedPct}%`,
);
