/**
 * luma 9.3's `WebGLDevice.getGLKey(value)` names a numeric GL constant by
 * walking EVERY property of the WebGL2 context (~900 constants and methods)
 * until one matches. `WEBGLTexture._setSamplerParameters` calls it, through
 * `getGLKeys()`, twice per sampler parameter of every new texture — as the
 * argument of a level-2 log line that never prints, because the argument is
 * built before the level is checked. A map-type cut creates dozens of textures
 * (rasters, contour bitmaps, palettes, particle state), and that walk was
 * ~25 ms of a cut's stall on the profiler (docs/watch-perf-plan.md, round 24).
 *
 * Same answer from a value → key table built once per context by the same
 * enumeration, so a value shared by several constants (0 is GL.POINTS, GL.ZERO,
 * GL.NONE …) still resolves to the first key exactly as the loop did. Only the
 * UPPER_CASE constants are tabled (immutable by construction; the context's
 * few camelCase numbers such as drawingBufferWidth change), and a value the
 * table doesn't know falls through to luma's own loop — so every answer is the
 * original's. Installed from deck's `onDeviceInitialized` off the device
 * instance's own prototype (no direct `@luma.gl/webgl` import), guarded on the
 * method's shape like the other luma patches: a different luma is left alone.
 */
export type PatchResult = "patched" | "already" | "skipped";

type GlKeyOptions = { emptyIfUnknown?: boolean };
type KeyedDevice = { gl: object };
export type GetGLKey = (this: KeyedDevice, value: unknown, options?: GlKeyOptions) => string;

const PATCHED = Symbol.for("gods.lumaGlKeyPatch");
const CONSTANT_KEY = /^[A-Z][A-Z0-9_]*$/;
const tables = new WeakMap<object, Map<number, string>>();

/** value → first UPPER_CASE key holding it, in the context's own enumeration order. */
export function glKeyTable(gl: object): Map<number, string> {
  let table = tables.get(gl);
  if (!table) {
    table = new Map();
    for (const key in gl) {
      if (!CONSTANT_KEY.test(key)) continue;
      const v = (gl as Record<string, unknown>)[key];
      if (typeof v === "number" && !table.has(v)) table.set(v, key);
    }
    tables.set(gl, table);
  }
  return table;
}

/** Wrap luma's getGLKey: answer constants from the table, everything else from the original. */
export function memoisedGetGLKey(original: GetGLKey): GetGLKey {
  return function (this: KeyedDevice, value, options) {
    const n = Number(value);
    const key = Number.isNaN(n) ? undefined : glKeyTable(this.gl).get(n);
    return key !== undefined ? `GL.${key}` : original.call(this, value, options);
  };
}

const src = (fn: unknown): string => (typeof fn === "function" ? Function.prototype.toString.call(fn) : "");

/** Patch whichever prototype in `device`'s chain owns getGLKey (exported for tests). */
export function patchGlKey(device: object): PatchResult {
  let proto: Record<string | symbol, unknown> | null = Object.getPrototypeOf(device);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "getGLKey")) proto = Object.getPrototypeOf(proto);
  if (!proto) return "skipped";
  if (proto[PATCHED]) return "already";
  // The 9.3 shape this relies on: a for-in over this.gl comparing each value.
  const original = proto.getGLKey;
  if (!/in\s+this\.gl\s*\)/.test(src(original))) return "skipped";
  Object.defineProperty(proto, "getGLKey", { value: memoisedGetGLKey(original as GetGLKey), writable: true, configurable: true });
  Object.defineProperty(proto, PATCHED, { value: true });
  return "patched";
}

/** Install on the live device (deck's onDeviceInitialized). Logs when the shape is unknown. */
export function installGlKeyPatch(device: object): PatchResult {
  const installed = patchGlKey(device);
  if (installed === "skipped") console.info("[globe] luma WebGLDevice.getGLKey shape changed — constant-name table not applied");
  return installed;
}
