#!/usr/bin/env node
/**
 * Parity check for lib/wl-grid-patch.ts against WeatherLayers' OWN GridLayer
 * composite: the same positions and the same sampled features (value +
 * direction) across camera moves, zoom changes, an image swap, nest bounds and
 * a density change. Run after a WeatherLayers / deck bump:
 *
 *   node scripts/wl-grid-parity.cjs
 *
 * Node only (no jest): the real WeatherLayers CJS build and deck's real
 * _GlobeViewport are loaded; the patch is compiled with tsc into a temp dir.
 * WeatherLayers spins up a Worker at import (stubbed) and its CJS build expects
 * icomesh / kdbush as bare default exports (a require hook hands them over).
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");
const pub = path.resolve(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "wl-grid-parity-"));
execFileSync("npx", ["tsc", "src/lib/wl-grid-positions.ts", "src/lib/wl-grid-patch.ts", "--outDir", out, "--module", "commonjs", "--target", "es2020", "--esModuleInterop", "--skipLibCheck", "--moduleResolution", "node", "--types", "node"], { cwd: pub, stdio: "inherit" });
module.paths.unshift(path.join(pub, "node_modules"));
for (const f of ["wl-grid-patch.js", "wl-grid-positions.js"]) {
  // the compiled files live outside the package: give them its node_modules
  const p = path.join(out, f);
  fs.writeFileSync(p, `module.paths.unshift(${JSON.stringify(path.join(pub, "node_modules"))});\n` + fs.readFileSync(p, "utf8"));
}
globalThis.Worker = class { constructor() {} postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} };
const Module = require("module");
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  const m = origRequire.apply(this, arguments);
  if ((id === "icomesh" || id === "kdbush") && m && typeof m.default === "function") return m.default;
  return m;
};

const WL = require(path.join(pub, "node_modules/weatherlayers-gl/dist/weatherlayers-deck.min.cjs"));
const deck = require(path.join(pub, "node_modules/@deck.gl/core"));
const Viewport = deck._GlobeViewport;
const patch = require(path.join(out, "wl-grid-patch.js"));
const positions = require(path.join(out, "wl-grid-positions.js"));

// Synthetic uv image: u,v bytes vary smoothly with position; alpha 255.
function makeImage(seed) {
  const width = 180, height = 90, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = Math.round(128 + 100 * Math.sin((x + seed) / 9) * Math.cos(y / 7));
    data[i + 1] = Math.round(128 + 100 * Math.cos((x - seed) / 11) * Math.sin(y / 5));
    data[i + 2] = 0; data[i + 3] = 255;
  }
  return { data, width, height };
}
const imageA = makeImage(0), imageB = makeImage(37);

// The internal composite's prototype, via GridLayer.renderLayers.
const layer = new WL.GridLayer({ id: "barbs", image: imageA, imageType: "VECTOR", imageUnscale: [-30, 30], style: "WIND_BARB" });
layer.state = { props: layer.props };
const [composite] = layer.renderLayers();
const proto = Object.getPrototypeOf(composite);
const origPos = proto._updatePositions, origFeat = proto._updateFeatures;
console.log("composite:", composite.constructor.layerName, "| patch result on a copy:", patch.patchGridComposite(class extends composite.constructor {}));

function self(props, viewport, patched) {
  const s = { props, state: {}, context: { viewport }, setState(u) { Object.assign(this.state, u); } };
  s._updateFeatures = patched ? patch.cachedUpdateFeatures(origFeat) : origFeat;
  s._updatePositions = patched ? patch.memoisedUpdatePositions(origPos) : origPos;
  return s;
}
const strip = (pts) => (pts || []).map((f) => [f.geometry.coordinates[0], f.geometry.coordinates[1], f.properties.value, f.properties.direction]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let failures = 0;
function check(label, a, b) {
  const ok = same(a, b);
  if (!ok) { failures++; console.log("MISMATCH", label, "orig", JSON.stringify(a).slice(0, 200), "\n   patched", JSON.stringify(b).slice(0, 200)); }
  return ok;
}
try {
const DEFAULTS = { image2: null, imageSmoothing: 0, imageInterpolation: "CUBIC", imageWeight: 0, imageMinValue: null, imageMaxValue: null };
const cases = [
  { name: "global bounds", props: { ...DEFAULTS, image: imageA, imageType: "VECTOR", imageUnscale: [-30, 30], bounds: [-180, -90, 180, 90], density: 0 } },
  { name: "nest bounds", props: { ...DEFAULTS, image: imageA, imageType: "VECTOR", imageUnscale: [-30, 30], bounds: [95, 20, 125, 42], density: 0 } },
  { name: "density 1", props: { ...DEFAULTS, image: imageA, imageType: "VECTOR", imageUnscale: [-30, 30], bounds: [-180, -90, 180, 90], density: 1 } },
];
for (const c of cases) {
  const o = self({ ...c.props }, null, false), p = self({ ...c.props }, null, true);
  const track = [[108.8, 28.9, 4.2], [109.1, 29.0, 4.4], [109.5, 29.3, 4.9], [110.2, 29.9, 5.3], [111.0, 30.4, 5.6], [111.4, 30.6, 5.8], [111.4, 30.6, 5.8], [105.0, 27.0, 3.1], [-140, -45, 2.4]];
  let steps = 0, pointsSeen = 0;
  for (const [longitude, latitude, zoom] of track) {
    const viewport = new Viewport({ width: 1920, height: 1080, longitude, latitude, zoom });
    o.context.viewport = viewport; p.context.viewport = viewport;
    o._updatePositions(); p._updatePositions();
    check(`${c.name} positions @${zoom}`, o.state.positions, p.state.positions);
    check(`${c.name} features @${zoom}`, strip(o.state.points), strip(p.state.points));
    steps++; pointsSeen += (p.state.points || []).length;
  }
  // image swap: features must follow the new image
  o.props = { ...c.props, image: imageB }; p.props = { ...c.props, image: imageB };
  o._updateFeatures(); p._updateFeatures();
  check(`${c.name} features after image swap`, strip(o.state.points), strip(p.state.points));
  // and back to A (cache from before must not resurface stale values for B)
  o.props = { ...c.props, image: imageA }; p.props = { ...c.props, image: imageA };
  o._updateFeatures(); p._updateFeatures();
  check(`${c.name} features back on A`, strip(o.state.points), strip(p.state.points));
  console.log(`${c.name}: ${steps} camera steps, ${pointsSeen} features compared, positions/features ${failures ? "DIFFER" : "identical"}`);
}
// speed sanity: values are the unscaled magnitudes, not bytes
const p = self({ ...DEFAULTS, image: imageA, imageType: "VECTOR", imageUnscale: [-30, 30], bounds: [-180, -90, 180, 90], density: 0 }, new Viewport({ width: 1920, height: 1080, longitude: 100, latitude: 30, zoom: 4.5 }), true);
p._updatePositions();
const vals = p.state.points.map((f) => f.properties.value);
console.log("sample values (m/s): min", Math.min(...vals).toFixed(2), "max", Math.max(...vals).toFixed(2), "count", vals.length, "calm(<2.45)", vals.filter((v) => v < 2.45).length);
console.log(failures ? `FAILURES: ${failures}` : "ALL IDENTICAL");
process.exitCode = failures ? 1 : 0;
} catch (e) { console.log("ERR:", e.message); console.log((e.stack || "").split("\n").slice(1, 6).map((l) => l.trim().slice(0, 160)).join("\n")); }
