/** @luma.gl/core resolves to src/test/mocks/luma.ts — a verbatim copy of luma
 *  9.3.5's UniformBlock, i.e. the buggy shape the patch targets. */
import { UniformBlock, UniformStore } from "@luma.gl/core";
import { installLumaUniformPatch, patchUniformBlock, patchUniformStore } from "./luma-uniform-patch";

const MAT4 = Array.from({ length: 16 }, (_, i) => i);

describe("luma UniformBlock redraw patch", () => {
  it("reproduces the 9.3.5 bug first: unchanged values still flag a rewrite", () => {
    const b = new UniformBlock({ name: "picking" });
    b.setUniforms({ isActive: 0, isAttribute: 0 });
    b.getAllUniforms(); // the buffer write clears the flags
    b.setUniforms({ isActive: 0, isAttribute: 0 });
    expect(b.needsRedraw).toBeTruthy();
  });

  it("patches the class once", () => {
    expect(patchUniformBlock(UniformBlock)).toBe("patched");
    expect(patchUniformBlock(UniformBlock)).toBe("already");
    expect(installLumaUniformPatch()).toBe("already");
  });

  it("patched: unchanged values leave a written block clean, a change flags it", () => {
    const b = new UniformBlock({ name: "project" });
    // Fresh block: 'initialized' survives until the first write, even for equal values.
    b.setUniforms({ viewProjectionMatrix: MAT4, devicePixelRatio: 1 });
    expect(b.needsRedraw).toBe("initialized");
    b.getAllUniforms();
    expect(b.needsRedraw).toBe(false);
    // Same values (new array instances, as deck hands them over every frame) → no rewrite.
    b.setUniforms({ viewProjectionMatrix: MAT4.slice(), devicePixelRatio: 1 });
    expect(b.needsRedraw).toBe(false);
    // The camera moved → one element differs → flagged, naming the block and key.
    const moved = MAT4.slice();
    moved[12] += 0.5;
    b.setUniforms({ viewProjectionMatrix: moved, devicePixelRatio: 1 });
    expect(b.needsRedraw).toBe("project.viewProjectionMatrix");
    // Typed arrays compare elementwise too.
    b.getAllUniforms();
    b.setUniforms({ viewProjectionMatrix: Float32Array.from(moved) });
    expect(b.needsRedraw).toBe(false);
    b.setUniforms({ devicePixelRatio: 2 });
    expect(b.needsRedraw).toBe("project.devicePixelRatio");
  });

  it("stores copies, so mutating the caller's array is still seen as a change", () => {
    const b = new UniformBlock({ name: "breathe" });
    const v = [1, 1];
    b.setUniforms({ alpha: v });
    b.getAllUniforms();
    v[0] = 0.5;
    b.setUniforms({ alpha: v });
    expect(b.needsRedraw).toBe("breathe.alpha");
  });

  it("skips a class whose methods don't have the 9.3 shape", () => {
    class Other {
      needsRedraw: false | string = false;
      setUniforms() {}
      _setUniform() {}
      getAllUniforms() {
        return {};
      }
    }
    const before = Other.prototype.setUniforms;
    expect(patchUniformBlock(Other)).toBe("skipped");
    expect(Other.prototype.setUniforms).toBe(before);
  });
});

/** The mock's shape (tsc resolves `@luma.gl/core` to the real types; jest to the mock). */
type MockStore = {
  uniformBlocks: Map<string, UniformBlock>;
  uniformBuffers: Map<string, { write(data: Uint8Array): void }>;
  shaderBlockWriters: Map<string, { getData(values: Record<string, unknown>): Uint8Array }>;
  updateUniformBuffers(): false | string;
  updateUniformBuffer(name: string): false | string;
};
const MockUniformStore = UniformStore as unknown as new () => MockStore;

describe("luma UniformStore update-loop patch", () => {
  function store() {
    const st = new MockUniformStore();
    const writes: Record<string, number> = { project: 0, picking: 0, orphan: 0 };
    for (const name of ["project", "picking", "orphan"]) {
      const b = new UniformBlock({ name });
      b.setUniforms({ v: 1 });
      st.uniformBlocks.set(name, b);
      st.shaderBlockWriters.set(name, { getData: () => new Uint8Array([1, 2, 3]) });
      if (name !== "orphan") st.uniformBuffers.set(name, { write: () => void writes[name]++ });
    }
    return { st, writes };
  }

  it("the lean loop writes the same buffers and clears the same flags as luma's per-block path", () => {
    // Reference: luma's own single-block method (the patch replaces only the loop).
    const a = store();
    let before: false | string = false;
    for (const name of a.st.uniformBlocks.keys()) {
      const r = a.st.updateUniformBuffer(name); // evaluate every block (no `||=` short-circuit)
      before ||= r;
    }
    expect(before).toBe("initialized");
    expect(a.writes).toEqual({ project: 1, picking: 1, orphan: 0 });
    expect(a.st.uniformBlocks.get("project")!.needsRedraw).toBe(false);
    expect(a.st.uniformBlocks.get("orphan")!.needsRedraw).toBe("initialized"); // no buffer yet → keeps its flag

    // installLumaUniformPatch() above already patched the store class too.
    expect(patchUniformStore(UniformStore)).toBe("already");
    const b = store();
    expect(b.st.updateUniformBuffers()).toBe("initialized");
    expect(b.writes).toEqual({ project: 1, picking: 1, orphan: 0 });
    expect(b.st.uniformBlocks.get("project")!.needsRedraw).toBe(false);
    expect(b.st.uniformBlocks.get("orphan")!.needsRedraw).toBe("initialized");
    // Nothing flagged → nothing written, no reason.
    expect(b.st.updateUniformBuffers()).toBe(false);
    expect(b.writes).toEqual({ project: 1, picking: 1, orphan: 0 });
    // The camera block changes → only it is rewritten.
    b.st.uniformBlocks.get("project")!.setUniforms({ v: 2 });
    expect(b.st.updateUniformBuffers()).toBe("project.v");
    expect(b.writes).toEqual({ project: 2, picking: 1, orphan: 0 });
  });

  it("skips a store whose methods don't have the 9.3 shape", () => {
    class Other {
      updateUniformBuffers() {}
      updateUniformBuffer() {}
      getUniformBufferData() {}
    }
    const before = Other.prototype.updateUniformBuffers;
    expect(patchUniformStore(Other)).toBe("skipped");
    expect(Other.prototype.updateUniformBuffers).toBe(before);
    expect(installLumaUniformPatch()).toBe("already");
  });
});
