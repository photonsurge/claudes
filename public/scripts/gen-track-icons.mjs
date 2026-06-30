/**
 * Bakes the live-track marker atlas (arrow / plane / ship) to a served PNG.
 *
 * Why a committed PNG instead of generating at runtime: under this deck.gl +
 * _GlobeView build, IconLayer/TextLayer atlases built from a *canvas* come back
 * blank, but a *loaded .png URL* draws fine. So we rasterise once here (sharp is
 * a dev-only tool, NOT available in the deployed output) and commit the result
 * to public/icons so IconLayer can load it at /icons/track-markers.png.
 *
 * Run after changing any silhouette: `node scripts/gen-track-icons.mjs`
 * Shapes mirror PLANE_SHAPE / SHIP_SHAPE / ARROW_SHAPE in
 * src/components/layers/tracks.ts — keep them in sync.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CELL = 64; // px per glyph cell
const S = 26; // unit → px scale (shapes are authored in roughly [-1, 1])

// Shapes in heading-relative (forward, right) unit space: +forward is the nose
// (north-up in the atlas), +right is 90° clockwise. Identical to tracks.ts.
const SHAPES = {
  arrow: [[1, 0], [-0.5, 0.55], [-0.5, -0.55]],
  plane: [
    [1.0, 0.0],
    [0.0, 0.1], [-0.1, 0.7], [-0.35, 0.7], [-0.25, 0.1],
    [-0.65, 0.1], [-0.8, 0.42], [-1.0, 0.42], [-0.9, 0.0],
    [-1.0, -0.42], [-0.8, -0.42], [-0.65, -0.1],
    [-0.25, -0.1], [-0.35, -0.7], [-0.1, -0.7], [0.0, -0.1],
  ],
  ship: [
    [1.0, 0.0],
    [0.25, 0.32], [-0.85, 0.28],
    [-0.85, -0.28], [0.25, -0.32],
  ],
};

// Atlas column order — must match ICON_MAPPING in tracks.ts.
const ORDER = ["arrow", "plane", "ship"];

/** (forward, right) → atlas pixel coords for the cell at column `col`. */
function toPx([f, r], col) {
  const cx = col * CELL + CELL / 2;
  const cy = CELL / 2;
  return [cx + r * S, cy - f * S]; // forward = up (−y)
}

const polys = ORDER.map((name, col) => {
  const pts = SHAPES[name].map((p) => toPx(p, col).map((n) => n.toFixed(1)).join(",")).join(" ");
  return `<polygon points="${pts}" fill="#ffffff"/>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * ORDER.length}" height="${CELL}">${polys}</svg>`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "../public/icons/track-markers.png");
await mkdir(dirname(out), { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${CELL * ORDER.length}×${CELL}, cols: ${ORDER.join(" ")})`);
