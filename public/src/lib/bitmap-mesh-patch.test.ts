import { installBitmapMeshPatch, memoisedCreateMesh, patchBitmapMesh } from "./bitmap-mesh-patch";

/** A deck-9-shaped stand-in: tessellates from this.props.bounds at the viewport's resolution. */
class FakeBitmap {
  static built = 0;
  props: { bounds: unknown };
  context: { viewport: { resolution?: number } };
  constructor(bounds: unknown, resolution?: number) {
    this.props = { bounds };
    this.context = { viewport: { resolution } };
  }
  _createMesh() {
    FakeBitmap.built++;
    const { bounds } = this.props;
    const resolution = this.context.viewport.resolution;
    return { bounds, resolution, positions: new Float64Array(3) };
  }
}

describe("BitmapLayer mesh memo", () => {
  it("shares one mesh between instances with the same bounds and resolution", () => {
    expect(patchBitmapMesh(FakeBitmap)).toBe("patched");
    expect(patchBitmapMesh(FakeBitmap)).toBe("already");
    const a = new FakeBitmap([-180, -90, 180, 90], 2)._createMesh();
    const b = new FakeBitmap([-180, -90, 180, 90], 2)._createMesh();
    expect(b).toBe(a);
    expect(FakeBitmap.built).toBe(1);
    // Different bounds, or a different resolution → its own mesh.
    const nest = new FakeBitmap([-6, 41, 10, 52], 2)._createMesh();
    expect(nest).not.toBe(a);
    const coarse = new FakeBitmap([-180, -90, 180, 90], 10)._createMesh();
    expect(coarse).not.toBe(a);
    expect(FakeBitmap.built).toBe(3);
  });

  it("memoisedCreateMesh is keyed on the resolved bounds and resolution", () => {
    let n = 0;
    const wrapped = memoisedCreateMesh(function () {
      n++;
      return { n };
    });
    const ctx = (bounds: unknown, resolution?: number) => ({ props: { bounds }, context: { viewport: { resolution } } });
    const first = wrapped.call(ctx([[0, 0], [0, 1], [1, 1], [1, 0]], 1));
    expect(wrapped.call(ctx([[0, 0], [0, 1], [1, 1], [1, 0]], 1))).toBe(first);
    expect(wrapped.call(ctx([[0, 0], [0, 1], [1, 1], [1, 0]], undefined))).not.toBe(first);
  });

  it("skips a class whose _createMesh doesn't read bounds + resolution (the jest mock does)", () => {
    class Other {
      _createMesh() {
        return {};
      }
    }
    expect(patchBitmapMesh(Other)).toBe("skipped");
    expect(installBitmapMeshPatch()).toBe("skipped");
  });
});
