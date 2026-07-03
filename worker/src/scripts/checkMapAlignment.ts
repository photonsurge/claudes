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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(__dirname, "../../..");
const GEOJSON = resolve(ROOT, "public/public/data/countries.geojson");
const OUTDIR = resolve(ROOT, "scratchpad/align");
const BASE = process.env.BASE ?? "http://localhost:10100";
const OUT_W = 720;

type Bbox = [number, number, number, number];
type Ring = [number, number][];

function rings(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === "Polygon") return geom.coordinates as Ring[];
  if (geom.type === "MultiPolygon") return (geom.coordinates as Ring[][]).flat();
  return [];
}

async function loadCoastline(): Promise<Ring[]> {
  if (!existsSync(GEOJSON)) throw new Error(`coastline not found: ${GEOJSON} — run ./fetch-assets.sh`);
  const gj = JSON.parse(await readFile(GEOJSON, "utf8")) as { features: { geometry: { type: string; coordinates: unknown } }[] };
  return gj.features.flatMap((f) => rings(f.geometry));
}

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

/** Coastline as an SVG overlay (red polylines) sized to the output raster. */
function coastlineSvg(coast: Ring[], bbox: Bbox, w: number, h: number): Buffer {
  const [west, south, east, north] = bbox;
  const px = (lo: number, la: number) => [
    ((lo - west) / (east - west) * (w - 1)).toFixed(1),
    ((north - la) / (north - south) * (h - 1)).toFixed(1),
  ];
  const lines: string[] = [];
  for (const ring of coast) {
    const pts = ring
      .filter(([lo, la]) => lo >= west - 2 && lo <= east + 2 && la >= south - 2 && la <= north + 2)
      .map(([lo, la]) => px(lo, la).join(","));
    if (pts.length > 1) lines.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#ff4646" stroke-width="1"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.join("")}</svg>`);
}

/** Texture PNG → greyscale RGB raw (R channel; nodata/α=0 → near-black), resized. */
async function greyscale(pngUrl: string): Promise<{ data: Buffer; w: number; h: number }> {
  const buf = Buffer.from(await (await fetch(BASE + pngUrl)).arrayBuffer());
  const img = sharp(buf).ensureAlpha().resize({ width: OUT_W });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const rgb = Buffer.allocUnsafe(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * ch];
    const a = ch >= 4 ? data[i * ch + 3] : 255;
    const o = i * 3;
    if (a === 0) { rgb[o] = 10; rgb[o + 1] = 10; rgb[o + 2] = 14; }
    else { rgb[o] = r; rgb[o + 1] = r; rgb[o + 2] = r; }
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
      const { data, w, h } = await greyscale(m.tex);
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
