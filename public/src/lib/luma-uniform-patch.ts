/**
 * luma.gl 9.3 `UniformBlock.setUniforms` marks its block for a GPU rewrite on
 * EVERY call — its `if (!this.needsRedraw) this.setNeedsRedraw(…)` runs whether
 * or not `_setUniform` found a changed value — so `UniformStore.
 * updateUniformBuffers` repacks (`getData`: a fresh ArrayBuffer + typed views)
 * and re-uploads (`bindBuffer` ×2 + `bufferSubData`) every uniform buffer of
 * every model on every draw: project, picking, the layer's own block, each
 * extension's block… when only `project` moved with the camera. On /watch in
 * OBS that plumbing was ~2 ms of a 33 ms frame across ~22 draws
 * (docs/watch-perf-plan.md, round 17).
 *
 * The block already records what changed (`modifiedUniforms`, reset together
 * with `needsRedraw` by `getAllUniforms()` when the buffer is written), so the
 * repair is to flag a redraw only when `_setUniform` recorded a change. Nothing
 * else depends on the flag: `updateUniformBuffer` writes iff `needsRedraw`, and
 * a block whose GPU buffer doesn't exist yet keeps its `"initialized"` flag
 * until it does, so the first upload still happens.
 *
 * Applied at runtime to the imported class (no install-time patching), guarded
 * on the 9.3 method shapes: a luma upgrade with a different implementation
 * leaves the class alone (and says so once in the console) instead of breaking.
 */
import { UniformBlock, UniformStore } from "@luma.gl/core";

type Block = {
  name: string;
  needsRedraw: false | string;
  modifiedUniforms: Record<string, boolean>;
  _setUniform(key: string, value: unknown): void;
  setNeedsRedraw(reason: string): void;
};

const PATCHED = Symbol.for("gods.lumaUniformPatch");

/** The repaired method: luma's, minus the unconditional flag (and the
 *  `${value}` array-to-string join it built for the reason each call). */
export function setUniformsIfChanged(this: Block, uniforms: Record<string, unknown>): void {
  for (const key in uniforms) {
    this._setUniform(key, uniforms[key]);
    if (!this.needsRedraw && this.modifiedUniforms[key]) {
      this.setNeedsRedraw(`${this.name}.${key}`);
    }
  }
}

export type PatchResult = "patched" | "already" | "skipped";

const src = (fn: unknown): string => (typeof fn === "function" ? Function.prototype.toString.call(fn) : "");

/** Patch a UniformBlock-shaped class in place (exported for tests). */
export function patchUniformBlock(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  // The 9.3 shapes this relies on: setUniforms flags unconditionally,
  // _setUniform records changes in modifiedUniforms, getAllUniforms clears both.
  const shapeOk =
    /setNeedsRedraw/.test(src(proto.setUniforms)) &&
    /modifiedUniforms\[/.test(src(proto._setUniform)) &&
    /modifiedUniforms\s*=\s*\{\}/.test(src(proto.getAllUniforms)) &&
    /needsRedraw\s*=\s*(false|!1)/.test(src(proto.getAllUniforms));
  if (!shapeOk) return "skipped";
  Object.defineProperty(proto, "setUniforms", { value: setUniformsIfChanged, writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

type Store = {
  uniformBlocks: Map<string, { needsRedraw: false | string }>;
  uniformBuffers: Map<string, { write(data: Uint8Array): void }>;
  getUniformBufferData(name: string): Uint8Array;
};

/**
 * `UniformStore.updateUniformBuffers`, minus the per-block detour: luma's calls
 * `updateUniformBuffer(name)` for every block on every draw, which re-fetches
 * the block and its buffer, reads the uniforms a second time purely to build a
 * level-4 log line, and joins the reasons for a level-3 one — ~0.4 ms of a
 * 33 ms frame across ~120 block visits once the rewrite patch above leaves most
 * of them with nothing to write. Same writes, same flag clearing
 * (`getUniformBufferData` → `getAllUniforms`), a block without a GPU buffer
 * yet keeps its flag for when it gets one.
 */
export function updateUniformBuffersLean(this: Store): false | string {
  let reason: false | string = false;
  for (const [name, block] of this.uniformBlocks) {
    if (!block.needsRedraw) continue;
    const buffer = this.uniformBuffers.get(name);
    if (!buffer) continue;
    reason ||= block.needsRedraw;
    buffer.write(this.getUniformBufferData(name));
  }
  return reason;
}

/** Patch a UniformStore-shaped class in place (exported for tests). */
export function patchUniformStore(ctor: { prototype: object }): PatchResult {
  const proto = ctor.prototype as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return "already";
  const shapeOk =
    /updateUniformBuffer\(/.test(src(proto.updateUniformBuffers)) &&
    /needsRedraw/.test(src(proto.updateUniformBuffer)) &&
    /\.write\(/.test(src(proto.updateUniformBuffer)) &&
    /getAllUniforms/.test(src(proto.getUniformBufferData));
  if (!shapeOk) return "skipped";
  Object.defineProperty(proto, "updateUniformBuffers", { value: updateUniformBuffersLean, writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

let installed: PatchResult | null = null;

/** Idempotent; call before the first deck.gl `Deck` is created. */
export function installLumaUniformPatch(): PatchResult {
  if (installed) return installed;
  installed = patchUniformBlock(UniformBlock);
  if (installed === "skipped") {
    console.info("[globe] luma UniformBlock shape changed — uniform-buffer rewrite patch not applied");
  }
  if (patchUniformStore(UniformStore) === "skipped") {
    console.info("[globe] luma UniformStore shape changed — uniform-buffer update loop patch not applied");
  }
  return installed;
}
