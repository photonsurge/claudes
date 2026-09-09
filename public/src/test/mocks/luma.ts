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

/** The parts of luma 9.3.5's `UniformStore` the update-loop patch touches — verbatim
 *  (`log.log(...)()` reduced to a no-op: probe.gl's logger returns one below its level). */
type Buf = { write(data: Uint8Array): void };
export class UniformStore {
  uniformBlocks = new Map<string, UniformBlock>();
  uniformBuffers = new Map<string, Buf>();
  shaderBlockWriters = new Map<string, { getData(values: Record<string, UniformValue>): Uint8Array }>();
  getUniformBufferData(uniformBufferName: string): Uint8Array {
    const uniformValues = this.uniformBlocks.get(uniformBufferName)?.getAllUniforms() || {};
    const shaderBlockWriter = this.shaderBlockWriters.get(uniformBufferName);
    return shaderBlockWriter?.getData(uniformValues) || new Uint8Array(0);
  }
  updateUniformBuffers(): false | string {
    let reason: false | string = false;
    for (const uniformBufferName of this.uniformBlocks.keys()) {
      const bufferReason = this.updateUniformBuffer(uniformBufferName);
      reason ||= bufferReason;
    }
    return reason;
  }
  updateUniformBuffer(uniformBufferName: string): false | string {
    const uniformBlock = this.uniformBlocks.get(uniformBufferName);
    let uniformBuffer = this.uniformBuffers.get(uniformBufferName);
    let reason: false | string = false;
    if (uniformBuffer && uniformBlock?.needsRedraw) {
      reason ||= uniformBlock.needsRedraw;
      // This clears the needs redraw flag
      const uniformBufferData = this.getUniformBufferData(uniformBufferName);
      uniformBuffer = this.uniformBuffers.get(uniformBufferName);
      uniformBuffer?.write(uniformBufferData);
      this.uniformBlocks.get(uniformBufferName)?.getAllUniforms();
    }
    return reason;
  }
}
