/**
 * deck's `TileLayer` (the sharp night / satellite / terrain tile overlays,
 * `layers/basemap.ts`) picks visible tiles by walking an OSM quadtree from the
 * root on every evaluation — and on a `_GlobeViewport` each node it visits
 * builds its bounding volume with `makeOrientedBoundingBoxFromPoints`: mean
 * point, covariance matrix, Jacobi eigen-decomposition, per node, per call.
 * `Tileset2D` re-evaluates whenever the viewport changes, i.e. EVERY frame of
 * any spin, orbit or fly-to — not just on a cut. Those three `@math.gl/culling`
 * frames were 7–15 % of every one of the 46 stalls in the round-30 profile,
 * over 2 s of self time in the minute (docs/watch-perf-plan.md, round 30).
 *
 * The recompute is redundant: `GlobeViewport.projectPosition` is a prototype
 * method that reads nothing off `this` (pure in `[lng, lat, Z]`), so a tile's
 * reference points — and its oriented bounding box — depend only on the tile's
 * own `(x, y, z)` and the elevation range. Never on where the camera is. So the
 * volumes are memoised per `(projection, tile, elevation range)` and shared
 * across frames; they are read-only downstream (`CullingVolume.computeVisibility`
 * reads centre/half-axes, `distanceTo` works in module scratch vectors).
 *
 * `OSMNode` is private to `tile-2d-traversal.js`, but it leaks: the nodes ARE
 * the return value of the public `Tileset2D.prototype.getTileIndices`. So the
 * class is reached the way the WeatherLayers composite is — wrap the public
 * method, take `constructor` off the first result, patch that, then put the
 * original method back.
 *
 * Guarded by BEHAVIOUR rather than by reading the source, because everything
 * the cache assumes is checkable: probe the real method with bare `{x, y, z}`
 * nodes and require that it (a) gives finite volumes, (b) repeats itself for
 * the same tile, (c) ignores `worldOffset` on this branch, and (d) actually
 * varies with the tile and with the elevation range. A deck that fails any of
 * those keeps its own method.
 */
import { _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import { godsLog } from "./globe-log";

export type PatchResult = "patched" | "already" | "skipped";

/** deck's own `project` argument: `viewport.projectPosition`, unbound. */
export type Project = (lngLat: number[]) => number[];
export type OsmNodeLike = { x: number; y: number; z: number };
export type GetBoundingVolume = (
  this: OsmNodeLike,
  zRange: [number, number],
  worldOffset: number,
  project: Project | null,
) => unknown;

const PATCHED = Symbol.for("gods.tileObbPatch");
/** Whole-globe coverage is ~1 400 nodes at z5 and ~87 000 at z8; past this the
 *  cache starts over rather than grow (the wl-grid-patch rule). */
const MAX_CACHED = 32_768;

/**
 * The projection can't be keyed by identity: `Viewport`'s constructor runs
 * `this.projectPosition = this.projectPosition.bind(this)`, so every viewport
 * hands out its own bound copy — and deck builds a new viewport every frame the
 * camera moves. Keying on the function object gave a fresh table per frame and
 * a 0 % hit rate. What the cache actually depends on is how the projection
 * BEHAVES, so a bound copy is fingerprinted once (a few sample points, held in
 * a WeakMap so it dies with its viewport) and the volumes live under that.
 */
const FINGERPRINT_SAMPLES: number[][] = [
  [0, 0, 0],
  [90, 45, 0],
  [-170, -60, 0],
  [0, 0, 1000],
];
/** Distinct projections in one session: one. The cap is a backstop. */
const MAX_TABLES = 8;

const fingerprints = new WeakMap<Project, string | null>();
const tables = new Map<string, Map<string, unknown>>();

/** A key for what `project` DOES, or null if it isn't a usable projection. */
export function projectionKey(project: Project): string | null {
  const known = fingerprints.get(project);
  if (known !== undefined) return known;
  let key: string | null = null;
  try {
    const parts: string[] = [];
    for (const sample of FINGERPRINT_SAMPLES) {
      const out = project(sample.slice());
      if (!Array.isArray(out) || out.length < 3 || !out.every((n) => Number.isFinite(n))) {
        parts.length = 0;
        break;
      }
      parts.push(out.join(","));
    }
    key = parts.length === FINGERPRINT_SAMPLES.length ? parts.join(";") : null;
  } catch {
    key = null;
  }
  fingerprints.set(project, key);
  return key;
}

function tableFor(fingerprint: string): Map<string, unknown> {
  let table = tables.get(fingerprint);
  if (!table) {
    if (tables.size >= MAX_TABLES) tables.clear();
    table = new Map();
    tables.set(fingerprint, table);
  }
  return table;
}

/** Cache key: everything the volume is a function of, minus the projection. */
export function volumeKey(node: OsmNodeLike, zRange: ArrayLike<number>): string {
  return `${node.z}/${node.x}/${node.y}|${zRange[0]}|${zRange[1]}`;
}

/**
 * Wrap `getBoundingVolume` so equal (projection, tile, elevation range) share
 * one volume. Only the custom-projection branch is cached: the Web Mercator
 * branch builds a cheap `AxisAlignedBoundingBox` and does depend on
 * `worldOffset`, so it hands straight back to the original.
 */
export function memoisedGetBoundingVolume(original: GetBoundingVolume): GetBoundingVolume {
  return function (this: OsmNodeLike, zRange, worldOffset, project) {
    if (typeof project !== "function" || worldOffset !== 0 || !zRange || zRange.length < 2) {
      return original.call(this, zRange, worldOffset, project);
    }
    const fingerprint = projectionKey(project);
    if (fingerprint === null) return original.call(this, zRange, worldOffset, project);
    const table = tableFor(fingerprint);
    const key = volumeKey(this, zRange);
    const hit = table.get(key);
    if (hit !== undefined) return hit;
    const volume = original.call(this, zRange, worldOffset, project);
    if (table.size >= MAX_CACHED) table.clear();
    table.set(key, volume);
    return volume;
  };
}

/** Drop every cached volume (tests; nothing in the app needs it). */
export function clearVolumeCache(): void {
  tables.clear();
}

/** A globe-shaped projection for the probe: non-degenerate, so the eigen
 *  decomposition of the reference points gives real half-axes. */
const PROBE_PROJECT: Project = (lngLat) => {
  const lambda = (lngLat[0] * Math.PI) / 180;
  const phi = (lngLat[1] * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const D = 1 + (lngLat[2] ?? 0);
  return [Math.sin(lambda) * cosPhi * D, -Math.cos(lambda) * cosPhi * D, Math.sin(phi) * D];
};

/** The numbers that define a volume, or null if it isn't a finite OBB. */
function digest(volume: unknown): number[] | null {
  if (!volume || typeof volume !== "object") return null;
  const { center, halfAxes } = volume as { center?: ArrayLike<number>; halfAxes?: ArrayLike<number> };
  if (!center || !halfAxes) return null;
  const out = [...Array.from(center), ...Array.from(halfAxes)];
  if (out.length === 0 || !out.every((n) => Number.isFinite(n))) return null;
  return out;
}

const same = (a: number[] | null, b: number[] | null): boolean =>
  a !== null && b !== null && a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Check the method really is a pure function of (tile, elevation range,
 * projection) — the only thing the cache assumes. Probing with a bare
 * `{x, y, z}` is what proves it reads nothing else off the node: anything it
 * expected to find there comes back undefined and the volume stops being finite.
 */
export function probeIsCacheable(fn: GetBoundingVolume): boolean {
  const at = (x: number, y: number, z: number, zRange: [number, number], offset: number) => {
    try {
      return digest(fn.call({ x, y, z }, zRange, offset, PROBE_PROJECT));
    } catch {
      return null;
    }
  };
  const base = at(3, 5, 4, [0, 0], 0);
  if (base === null) return false;
  return (
    same(base, at(3, 5, 4, [0, 0], 0)) && // deterministic — no hidden state
    same(base, at(3, 5, 4, [0, 0], 2)) && // worldOffset unused on this branch
    !same(base, at(4, 5, 4, [0, 0], 0)) && // varies with the tile
    !same(base, at(3, 5, 4, [0, 1], 0)) // varies with the elevation range
  );
}

/** Patch an OSMNode-shaped class in place (exported for tests). */
export function patchOsmNode(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  const original = proto.getBoundingVolume;
  if (typeof original !== "function" || original.length !== 3) return "skipped";
  if (!probeIsCacheable(original as GetBoundingVolume)) return "skipped";
  Object.defineProperty(proto, "getBoundingVolume", {
    value: memoisedGetBoundingVolume(original as GetBoundingVolume),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

let nodeReported = false;

/**
 * Wrap a Tileset2D-shaped class's `getTileIndices` to patch the node class it
 * returns, then restore the original method — the wrapper exists only to catch
 * one geospatial result. A non-geospatial tileset returns plain `{x, y, z}`
 * objects with no `getBoundingVolume`; those are ignored and the wrapper waits.
 */
export function patchTileset(ctor: { prototype?: object } | undefined | null): PatchResult {
  const proto = ctor?.prototype as Record<string | symbol, unknown> | undefined;
  if (!proto) return "skipped";
  if (proto[PATCHED]) return "already";
  const original = proto.getTileIndices;
  if (typeof original !== "function") return "skipped";
  const restore = () => {
    Object.defineProperty(proto, "getTileIndices", { value: original, writable: true, configurable: true });
  };
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const out = (original as (...a: unknown[]) => unknown).apply(this, args);
    const first = Array.isArray(out) ? out[0] : undefined;
    if (first && typeof first === "object" && typeof (first as OsmNodeLike & { getBoundingVolume?: unknown }).getBoundingVolume === "function") {
      const result = patchOsmNode((first as { constructor: { prototype: object } }).constructor);
      if (!nodeReported) {
        nodeReported = true;
        // Says out loud whether the cache is live. Whether the quadtree runs at
        // all depends on a tile basemap being on air (satellite/terrain/night at
        // zoom ≥ TILE_MIN_ZOOM), so on a tile-less scene NEITHER line appears —
        // which is what made round 31 unverifiable from a profile alone. This is
        // the line to look for in the CEF console when checking it.
        godsLog(
          result === "skipped"
            ? "[globe] deck OSMNode.getBoundingVolume shape changed — tile bounding-volume cache not applied"
            : "[globe] deck tile bounding-volume cache active",
        );
      }
      restore();
    }
    return out;
  };
  Object.defineProperty(proto, "getTileIndices", { value: wrapped, writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

let installed: PatchResult | null = null;
/** Idempotent; call before the first deck.gl `Deck` is created. */
export function installTileObbPatch(): PatchResult {
  if (installed) return installed;
  installed = patchTileset(Tileset2D as unknown as { prototype?: object } | undefined);
  if (installed === "skipped") console.info("[globe] deck Tileset2D.getTileIndices shape changed — tile bounding-volume cache not applied");
  return installed;
}
