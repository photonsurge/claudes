// scripts/checkMapAlignment.ts — `yarn check:maps`
// Dump a coastline-overlay per weather map so you can eyeball whether each baked
// texture is georeferenced correctly. For every base + nest the manifest serves, it
// downloads the BAKED texture, renders it greyscale (the model's own land/sea thermal
// contrast), and draws the true coastline (red) over it clipped to that map's bbox →
// scratchpad/align/<sourceId>.png. Aligned = grey coast/relief sits under the red lines;
// drift/stretch = the source grid is mis-registered (e.g. a projected `.om` baked flat).
//
// Checks the SERVED textures, so it validates the whole pipeline including the worker's
// reprojection (weather/reproject.ts) — no projection math here, just overlay + eyeball.
// Pure Node (sharp, already a dep) — no Python. Needs `public` running + the coastline
// geojson (public/public/data/countries.geojson; run ./fetch-assets.sh first if missing).
//
//   yarn check:maps                     # all maps
//   yarn check:maps --var temp          # one variable's portfolio
//   yarn check:maps --only ukv,dmi-europe
//   BASE=http://host:10100 yarn check:maps

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { type Bbox, loadCoastline, coastlineSvg } from "./coastline";

const ROOT = resolve(__dirname, "../../..");
const OUTDIR = resolve(ROOT, "scratchpad/align");
const BASE = process.env.BASE ?? "http://localhost:10100";
const OUT_W = 720;

interface MapEntry { kind: "base" | "nest"; variable: string; bbox: Bbox; tex: string; }

/** Unique sourceId → entry across every variable's base + nests (first-seen wins). */
function collectMaps(manifest: any, wantVar?: string): Map<string, MapEntry> {
  const out = new Map<string, MapEntry>();
  for (const [vid, v] of Object.entries<any>(manifest.variables)) {
    if (wantVar && vid !== wantVar) continue;
    const baseFiles = v.files ?? {};
    const baseTex = Object.values<string>(baseFiles)[0];
    if (baseTex && v.sourceId && !out.has(v.sourceId)) {
      out.set(v.sourceId, { kind: "base", variable: vid, bbox: v.bbox ?? manifest.bounds, tex: baseTex });
    }
    for (const n of v.nests ?? []) {
      const tex = Object.values<string>(n.files ?? {})[0];
      if (tex && n.sourceId && !out.has(n.sourceId)) {
        out.set(n.sourceId, { kind: "nest", variable: vid, bbox: n.bbox, tex });
      }
    }
  }
  return out;
}

/**
 * Texture PNG → greyscale RGB raw (R channel; nodata/α=0 → near-black), resized to the
 * GEOGRAPHIC bbox aspect (how the client stretches it over `bounds` on the globe) — NOT
 * the texture's own pixel aspect, which would shear the image and fake a misalignment.
 *
 * The R channel is the low byte of the SCALED value, so a field whose values fill only a
 * fraction of its `imageUnscale` range (e.g. 0–3 m waves in a 0–30 m unscale → R 0–25)
 * renders near-black and looks "blank" even though data is present. So we CONTRAST-STRETCH
 * the opaque pixels across the 2nd–98th percentile of their own R range → the field's
 * shape (and thus its alignment) is visible regardless of amplitude. Purely a display
 * transform; it does not touch the served texture.
 */
async function greyscale(pngUrl: string, bbox: Bbox): Promise<{ data: Buffer; w: number; h: number }> {
  const [west, south, east, north] = bbox;
  const targetH = Math.max(1, Math.round(OUT_W * (north - south) / (east - west)));
  const buf = Buffer.from(await (await fetch(BASE + pngUrl)).arrayBuffer());

  // Resize the REAL texture ONCE (sharp's own pipeline), then read it out. Reconstructing a
  // raw buffer by hand and resizing that is what introduced lane/stripe artifacts — this
  // keeps a single tested resize of the actual image, so the overlay reflects the texture.
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .resize({ width: OUT_W, height: targetH, fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  // LINEAR percentile stretch of opaque R into [40,255] so a low-amplitude field (e.g. 0–3 m
  // waves in a 0–30 m imageUnscale) is visible without looking blank. Monotone ramp → no
  // banding; bounds = 2nd–98th percentile so outliers don't flatten it. Display-only.
  const hist = new Uint32Array(256);
  let opaque = 0;
  for (let i = 0; i < w * h; i++) {
    if ((ch >= 4 ? data[i * ch + 3] : 255) === 0) continue;
    hist[data[i * ch]]++; opaque++;
  }
  let lo = 0, hi = 255;
  if (opaque > 0) {
    const loN = opaque * 0.02, hiN = opaque * 0.98;
    let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= loN) { lo = v; break; } }
    c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= hiN) { hi = v; break; } }
    if (hi <= lo) hi = lo + 1;
  }
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(40, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 215) + 40));
  }

  const rgb = Buffer.allocUnsafe(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const a = ch >= 4 ? data[i * ch + 3] : 255;
    const o = i * 3;
    if (a === 0) { rgb[o] = 10; rgb[o + 1] = 10; rgb[o + 2] = 14; }
    else { const g = lut[data[i * ch]]; rgb[o] = g; rgb[o + 1] = g; rgb[o + 2] = g; }
  }
  return { data: rgb, w, h };
}

async function main() {
  const args = process.argv.slice(2);
  const argVal = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const wantVar = argVal("--var");
  const only = argVal("--only")?.split(",").map((s) => s.trim());

  await mkdir(OUTDIR, { recursive: true });
  const coast = await loadCoastline();
  let manifest: any;
  try {
    manifest = await (await fetch(BASE + "/api/weather/manifest")).json();
  } catch (err) {
    throw new Error(`could not fetch manifest from ${BASE} — is \`public\` running? (${String(err)})`);
  }

  const maps = collectMaps(manifest, wantVar);
  console.log(`== map alignment overlays -> scratchpad/align/  (grey=model, red=coastline)`);
  for (const sid of [...maps.keys()].sort()) {
    if (only && !only.includes(sid)) continue;
    const m = maps.get(sid)!;
    try {
      const { data, w, h } = await greyscale(m.tex, m.bbox);
      const svg = coastlineSvg(coast, m.bbox, w, h);
      const out = resolve(OUTDIR, `${sid}.png`);
      await sharp(data, { raw: { width: w, height: h, channels: 3 } })
        .composite([{ input: svg, top: 0, left: 0 }])
        .png()
        .toFile(out);
      console.log(`  ${sid.padEnd(18)} ${m.kind.padEnd(4)} ${m.variable.padEnd(8)} bbox=[${m.bbox}] -> ${sid}.png`);
    } catch (err) {
      console.log(`  ${sid.padEnd(18)} FAILED: ${String(err)}`);
    }
  }
  console.log("Open the PNGs and confirm the grey land/relief sits under the red coastline.");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
