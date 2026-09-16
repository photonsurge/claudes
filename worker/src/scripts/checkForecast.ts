/**
 * `yarn check:forecast [lat] [lng] [variable,variable…]`
 *
 * Why this exists: the on-air 3-DAY FORECAST card reads its numbers from the
 * rolling WeatherForecastFrame store, and when one of them looks wrong (the
 * wind row reading a flat 0 m/s everywhere) there are four different things it
 * could be, none visible from the card:
 *
 *   1. no frames archived for that variable at all,
 *   2. frames archived but from a source whose bake is dead (every pixel the
 *      middle byte — a uv frame of all-zero wind),
 *   3. frames whose metadata lost its decode range, so every byte decodes to
 *      the same physical value,
 *   4. a finer-resolution nest winning `pickFramesForPoint` over the global run
 *      and contributing its own (possibly empty) field at that point.
 *
 * So this prints, per variable: what's in the store, which model's frames win
 * at the probe point, the decode range they carry, the raw byte spread of the
 * winning frame, and the values that actually come back out of the sampler.
 * Read-only — it opens Mongo and the blob store and writes nothing.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { pickFramesForPoint } from "@photonsurge/shared/weather/pick";
import { usableUnscale } from "@photonsurge/shared/weather/sample";
import { decodeFrame, type DecodableFrame } from "../weather/frameDecode";
import { sampleForecastPoint } from "../weather/sampleService";

const DEFAULT_VARIABLES = ["temp", "wind", "gust", "rain", "cloud", "storm"];
/** Match the detailed card strip's horizon (4 days + a day of slack). */
const MAX_HOURS = 120;

const n = (v: number | null | undefined, dp = 2) => (v == null ? "—" : v.toFixed(dp));

/** Raw byte spread of a decoded frame — the "is the bake dead?" test. A healthy
 *  global wind frame spans roughly bytes 90..165 either side of the 127/128
 *  zero point; a dead one is pinned AT 127/128 and decodes to 0 m/s. */
function byteStats(rgba: Uint8Array, channel: 0 | 1) {
  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4 * 37) {
    if (rgba[i + 3] === 0) continue;
    const b = rgba[i + channel];
    if (b < min) min = b;
    if (b > max) max = b;
    sum += b;
    count += 1;
  }
  return count ? { min, max, mean: sum / count, count } : null;
}

async function main() {
  const lat = Number(process.argv[2] ?? 51.5);
  const lng = Number(process.argv[3] ?? -0.12);
  const variables = (process.argv[4] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const wanted = variables.length ? variables : DEFAULT_VARIABLES;

  const db = await getAppDb();
  console.log(`\nforecast store probe @ ${lat}, ${lng}  (horizon ${MAX_HOURS}h)\n`);

  const stored = await db.weatherForecastFrames.variables();
  console.log(`variables in store: ${stored.length ? stored.sort().join(", ") : "(none)"}\n`);

  for (const variable of wanted) {
    const meta = await db.weatherForecastFrames.listMeta({ variable });
    if (!meta.length) {
      console.log(`${variable.padEnd(6)} NO FRAMES in the forecast store`);
      continue;
    }

    // Per model: how many frames, at what resolution, with what decode range.
    const byModel = new Map<string, typeof meta>();
    for (const m of meta) {
      const rows = byModel.get(m.model) ?? [];
      rows.push(m);
      byModel.set(m.model, rows);
    }

    const picked = pickFramesForPoint(meta, lat, lng).filter(
      (m) => new Date(m.validTime).getTime() <= Date.now() + MAX_HOURS * 3600 * 1000,
    );
    const winners = new Set(picked.map((m) => m.model));

    console.log(`${variable.padEnd(6)} ${meta.length} frames · ${byModel.size} model(s)`);
    for (const [model, rows] of byModel) {
      const first = rows[0];
      const range = usableUnscale(first.vectorUnscale) ?? usableUnscale(first.imageUnscale);
      console.log(
        `         ${winners.has(model) ? "→" : " "} ${model.padEnd(14)} ${String(rows.length).padStart(4)} frames` +
          `  res ${first.grid.res}  ${first.encoding}` +
          `  range ${range ? `[${range[0]}, ${range[1]}]` : "MISSING/DEGENERATE"}` +
          `  units ${first.units || "(none)"}`,
      );
    }
    console.log(`         picked at point: ${picked.length} frames from [${[...winners].join(", ") || "none"}]`);

    // Byte spread of the frame the sampler will actually read first.
    if (picked.length) {
      const full = await db.weatherForecastFrames.getByID(picked[0].id);
      if (!full) {
        console.log("         first picked frame has NO BYTES in the blob store");
      } else {
        const grid = await decodeFrame(full as unknown as DecodableFrame);
        const r = byteStats(grid.rgba, 0);
        const g = byteStats(grid.rgba, 1);
        console.log(
          `         bytes R ${r ? `${r.min}..${r.max} (mean ${n(r.mean, 1)})` : "all nodata"}` +
            (full.encoding === "uv" ? `  G ${g ? `${g.min}..${g.max} (mean ${n(g.mean, 1)})` : "all nodata"}` : ""),
        );
        if (full.encoding === "uv" && r && r.max - r.min <= 2) {
          console.log("         ^^ FLAT vector field — the bake, not the sampler, is what's zero");
        }
      }
    }

    // What the sampler hands the day cards.
    const series = await sampleForecastPoint(db, { lat, lng, variables: [variable], maxHours: MAX_HOURS });
    const rows = series.samplesByVariable[variable] ?? [];
    const values = rows.map((r) => r.value);
    if (!rows.length) {
      console.log("         sampled: NOTHING (point outside every frame, nodata, or no decode range)\n");
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    console.log(
      `         sampled: ${rows.length} steps  min ${n(Math.min(...values))}  mean ${n(mean)}  max ${n(Math.max(...values))}` +
        (rows[0].u != null ? `  (u/v present — direction available)` : ""),
    );
    console.log(
      `         first steps: ${rows
        .slice(0, 4)
        .map((r) => `${r.t.slice(5, 16)}=${n(r.value, 1)}`)
        .join("  ")}\n`,
    );
  }

  process.exit(0);
}

main().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
