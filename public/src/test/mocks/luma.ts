/** Mock for @luma.gl/core — a faithful copy of luma 9.3.5's `UniformBlock`
 * (the class lib/luma-uniform-patch.ts repairs at runtime), so the patch can be
 * exercised in jest without loading the real ESM package. Keep in lock-step
 * with node_modules/@luma.gl/core/dist/portable/uniform-block.js. */
export type UniformValue = number | boolean | number[] | Float32Array | Int32Array | Uint32Array;

function isNumberArray(v: unknown): v is ArrayLike<number> {
  return Array.isArray(v) || ArrayBuffer.isView(v);
}
/** luma's utils/array-equal: elementwise for number arrays up to 16 long. */
function arrayEqual(a: unknown, b: unknown, limit = 16): boolean {
  if (a === b) return true;
  if (!isNumberArray(a) || !isNumberArray(b)) return false;
  if (a.length !== b.length) return false;
  if (a.length > Math.min(limit, 128)) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function arrayCopy<T>(a: T): T {
  return isNumberArray(a) ? ((a as unknown as number[]).slice() as unknown as T) : a;
}

export class UniformBlock {
  name: string;
  uniforms: Record<string, UniformValue> = {};
  modifiedUniforms: Record<string, boolean> = {};
  modified = true;
  bindingLayout: Record<string, unknown> = {};
  needsRedraw: false | string = "initialized";
  constructor(props?: { name?: string }) {
    this.name = props?.name || "unnamed";
  }
  /** Set a map of uniforms */
  setUniforms(uniforms: Record<string, UniformValue>): void {
    for (const [key, value] of Object.entries(uniforms)) {
      this._setUniform(key, value);
      if (!this.needsRedraw) {
        this.setNeedsRedraw(`${this.name}.${key}=${value}`);
      }
    }
  }
  setNeedsRedraw(reason: string): void {
    this.needsRedraw = this.needsRedraw || reason;
  }
  /** Returns all uniforms */
  getAllUniforms(): Record<string, UniformValue> {
    this.modifiedUniforms = {};
    this.needsRedraw = false;
    return this.uniforms || {};
  }
  /** Set a single uniform */
  _setUniform(key: string, value: UniformValue): void {
    if (arrayEqual(this.uniforms[key], value)) {
      return;
    }
    this.uniforms[key] = arrayCopy(value);
    this.modifiedUniforms[key] = true;
    this.modified = true;
  }
}
