/**
 * deck.gl's BitmapLayer tessellates its bounds into a globe-following mesh in
 * `_createMesh()` every time an instance initialises — and a map-type cut
 * creates fresh raster / contour bitmap instances over the same bounds, so each
 * cut re-tessellated the same global and nest quads (~40 ms of a cut's stall on
 * the profiler; docs/watch-perf-plan.md, round 23). The mesh depends only on
 * the bounds and the viewport's `resolution`, and its typed arrays are only
 * read (each instance uploads them to its own GPU buffers), so instances can
 * share one: memoised by bounds + resolution, a small LRU.
 *
 * A runtime prototype patch, guarded on the method's shape like the luma ones:
 * a different deck leaves the class alone.
 */
import { BitmapLayer } from "@deck.gl/layers";

type Meshy = { props: { bounds: unknown }; context?: { viewport?: { resolution?: number } } };
type CreateMesh = (this: Meshy) => unknown;

const PATCHED = Symbol.for("gods.bitmapMeshPatch");
const MAX_ENTRIES = 32;
const meshes = new Map<string, unknown>();

/** Wrap a `_createMesh` so equal (bounds, resolution) share one mesh object. */
export function memoisedCreateMesh(original: CreateMesh): CreateMesh {
  return function (this: Meshy) {
    const key = `${JSON.stringify(this.props.bounds)}|${this.context?.viewport?.resolution ?? ""}`;
    const hit = meshes.get(key);
    if (hit) return hit;
    const mesh = original.call(this);
    if (meshes.size >= MAX_ENTRIES) {
      const oldest = meshes.keys().next().value;
      if (oldest !== undefined) meshes.delete(oldest);
    }
    meshes.set(key, mesh);
    return mesh;
  };
}

export type PatchResult = "patched" | "already" | "skipped";

export function patchBitmapMesh(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  const fn = proto._createMesh;
  const src = typeof fn === "function" ? Function.prototype.toString.call(fn) : "";
  // deck 9's shape: reads this.props.bounds and the viewport's resolution.
  if (!/bounds/.test(src) || !/resolution/.test(src)) return "skipped";
  Object.defineProperty(proto, "_createMesh", { value: memoisedCreateMesh(fn as CreateMesh), writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

let installed: PatchResult | null = null;
/** Idempotent; call before the first deck.gl `Deck` is created. */
export function installBitmapMeshPatch(): PatchResult {
  if (installed) return installed;
  installed = patchBitmapMesh(BitmapLayer);
  if (installed === "skipped") console.info("[globe] deck BitmapLayer._createMesh shape changed — mesh memo not applied");
  return installed;
}
