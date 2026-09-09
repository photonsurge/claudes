import { glKeyTable, installGlKeyPatch, memoisedGetGLKey, patchGlKey, type GetGLKey } from "./luma-glkey-patch";

/** A WebGL2-context-shaped stand-in: methods, a mutable camelCase number, and
 *  constants on the prototype (with 0 shared by several, as in the real one). */
function makeGl() {
  class Ctx {
    drawingBufferWidth = 1920;
    bindTexture() {}
    texParameteri() {}
  }
  Object.assign(Ctx.prototype, {
    POINTS: 0,
    ZERO: 0,
    NONE: 0,
    DEPTH_BUFFER_BIT: 256,
    STENCIL_BUFFER_BIT: 1024,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_WRAP_S: 10242,
    NEAREST: 9728,
    LINEAR: 9729,
    CLAMP_TO_EDGE: 33071,
    REPEAT: 10497,
  });
  return new Ctx();
}

/** luma 9.3.5's own getGLKey, verbatim — the reference every answer must match. */
class RefDevice {
  constructor(public gl: object) {}
  getGLKey(value: unknown, options?: { emptyIfUnknown?: boolean }): string {
    const number = Number(value);
    for (const key in this.gl) {
      // @ts-expect-error indexing a loosely typed context
      if (this.gl[key] === number) return `GL.${key}`;
    }
    return options?.emptyIfUnknown ? "" : String(value);
  }
}

describe("luma getGLKey table", () => {
  it("answers exactly what luma's loop answers, first key wins on shared values", () => {
    const gl = makeGl();
    const ref = new RefDevice(gl);
    const fast = memoisedGetGLKey(RefDevice.prototype.getGLKey as GetGLKey).bind({ gl });
    for (const v of [0, 256, 1024, 10240, 10241, 10242, 9728, 9729, 33071, 10497, "9729", "10240", 1920, 12345, "abc", NaN, undefined]) {
      expect(fast(v)).toBe(ref.getGLKey(v));
      expect(fast(v, { emptyIfUnknown: true })).toBe(ref.getGLKey(v, { emptyIfUnknown: true }));
    }
    expect(fast(0)).toBe("GL.POINTS");
    expect(fast(12345)).toBe("12345");
    expect(fast(12345, { emptyIfUnknown: true })).toBe("");
  });

  it("enumerates the context once, not once per lookup", () => {
    let walks = 0;
    const gl = new Proxy(makeGl(), {
      ownKeys(t) {
        walks++;
        return Reflect.ownKeys(t);
      },
    });
    const table = glKeyTable(gl);
    expect(table.get(9729)).toBe("LINEAR");
    expect(walks).toBe(1);
    glKeyTable(gl);
    glKeyTable(gl);
    expect(walks).toBe(1);
    // Only immutable UPPER_CASE constants are tabled; camelCase numbers stay with the loop.
    expect(table.has(1920)).toBe(false);
  });

  it("patches the prototype that owns getGLKey, once, and keeps the answers", () => {
    class Device extends RefDevice {}
    const device = new Device(makeGl());
    const before = device.getGLKey(33071);
    expect(patchGlKey(device)).toBe("patched");
    expect(patchGlKey(device)).toBe("already");
    expect(installGlKeyPatch(device)).toBe("already");
    expect(device.getGLKey(33071)).toBe(before);
    expect(device.getGLKey(0)).toBe("GL.POINTS");
    expect(device.getGLKey(7, { emptyIfUnknown: true })).toBe("");
  });

  it("leaves a getGLKey of another shape alone", () => {
    class Other {
      gl = makeGl();
      getGLKey(value: unknown) {
        return `k${String(value)}`;
      }
    }
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const dev = new Other();
    expect(installGlKeyPatch(dev)).toBe("skipped");
    expect(dev.getGLKey(1)).toBe("k1");
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
    expect(patchGlKey({})).toBe("skipped");
  });
});
