// scripts/checkSatimg.ts — `yarn check:satimg`
// Dump a coastline-overlay per geostationary satellite frame so you can eyeball
// whether the disk is georeferenced correctly — the satimg sibling of `check:maps`.
// For every bird it renders the full-globe RGBA frame and draws the true coastline
// (red) over it → scratchpad/satimg/<satId>.png. Aligned = the disk's land sits under
// the red lines; a mis-registered reprojection shows the coast sliding off the disk.
//
// The frame is either:
//   • REAL   — the worker-baked PNG fetched from a running `public` (/api/satimg),
//              i.e. the actual satpy reprojection. Used automatically when reachable.
//   • SYNTHETIC — a geometrically-correct stand-in disk (satimg/disk.ts) computed
//              from the geostationary visibility footprint. Used when no real frame
//              exists yet (satpy not set up), so this tool is runnable TODAY and
//              validates the disk lands over the right region + the overlay compositing.
//
// Pure Node (sharp, already a dep) — no Python. Needs the coastline geojson
// (public/public/data/countries.geojson; run ./fetch-assets.sh first if missing).
//
//   yarn check:satimg                    # every bird, real-if-available else synthetic
//   yarn check:satimg --sat himawari9    # one bird
//   yarn check:satimg --synthetic        # force the stand-in disk (no public needed)
//   BASE=http://host:10100 yarn check:satimg

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { SATIMG_SATS, SATIMG_GLOBAL_BOUNDS } from "@photonsurge/shared/satimg/types";
import { loadCoastline, coastlineSvg } from "./coastline";
import { syntheticDiskRgba } from "../satimg/disk";

const ROOT = resolve(__dirname, "../../..");
const OUTDIR = resolve(ROOT, "scratchpad/satimg");
const BASE = process.env.BASE ?? "http://localhost:10100";
const OUT_W = 1440;
const OUT_H = OUT_W / 2; // full-globe plate-carrée is 2:1

interface Frame {
  data: Buffer;
  w: number;
  h: number;
  mode: "real" | "synthetic";
}

/** Try the worker-baked frame from a running `public`; null if unreachable / unbaked. */
async function fetchReal(satId: string): Promise<Frame | null> {
  try {
    const res = await fetch(`${BASE}/api/satimg/frame.png?sat=${encodeURIComponent(satId)}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .resize({ width: OUT_W, height: OUT_H, fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height, mode: "real" };
  } catch {
    return null;
  }
}

function synthetic(subLon: number): Frame {
  return { data: syntheticDiskRgba(OUT_W, OUT_H, subLon), w: OUT_W, h: OUT_H, mode: "synthetic" };
}

async function main() {
  const args = process.argv.slice(2);
  const argVal = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const wantSat = argVal("--sat");
  const forceSynthetic = args.includes("--synthetic");

  await mkdir(OUTDIR, { recursive: true });
  const coast = await loadCoastline();
  const svg = coastlineSvg(coast, SATIMG_GLOBAL_BOUNDS, OUT_W, OUT_H);

  const sats = Object.values(SATIMG_SATS).filter((s) => !wantSat || s.id === wantSat);
  if (!sats.length) throw new Error(`no such bird '${wantSat}' in SATIMG_SATS`);

  console.log(`== satimg disk overlays -> scratchpad/satimg/  (colour=disk, red=coastline)`);
  for (const sat of sats) {
    try {
      const frame = (!forceSynthetic && (await fetchReal(sat.id))) || synthetic(sat.subLon);
      const out = resolve(OUTDIR, `${sat.id}.png`);
      await sharp(frame.data, { raw: { width: frame.w, height: frame.h, channels: 4 } })
        .composite([{ input: svg, top: 0, left: 0 }])
        .png()
        .toFile(out);
      console.log(
        `  ${sat.id.padEnd(12)} ${frame.mode.padEnd(9)} subLon=${String(sat.subLon).padStart(6)} -> ${sat.id}.png`,
      );
    } catch (err) {
      console.log(`  ${sat.id.padEnd(12)} FAILED: ${String(err)}`);
    }
  }
  console.log(
    "Open the PNGs: the disk should sit over its regions and the red coastline should hug the disk's land.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
