/** @luma.gl/core resolves to src/test/mocks/luma.ts — a verbatim copy of luma
 *  9.3.5's UniformBlock, i.e. the buggy shape the patch targets. */
import { UniformBlock } from "@luma.gl/core";
import { installLumaUniformPatch, patchUniformBlock } from "./luma-uniform-patch";

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
