import { keepAliveUpdateState, particleShapeChanged, patchParticleInner } from "./particle-layer";

/** A stand-in for WeatherLayers' inner particle-line layer and its deck parent. */
function makeInner() {
  const calls: string[] = [];
  class Parent {
    updateState(_params: unknown) {
      calls.push("super");
    }
  }
  class Inner extends Parent {
    state: { initialized?: boolean } = {};
    _setupTransformFeedback() {
      calls.push("setup");
      this.state.initialized = true;
    }
    _deleteTransformFeedback() {
      calls.push("delete");
      this.state.initialized = false;
    }
    _updatePalette() {
      calls.push("palette");
    }
  }
  return { Inner, calls };
}

type P = { imageType?: string; numParticles?: number; maxAge?: number; width?: number; visible?: boolean; palette?: unknown };
const vec = (o: P = {}): P => ({ imageType: "VECTOR", numParticles: 6000, maxAge: 30, width: 2, visible: true, ...o });
type Updatable = { updateState(params: { props: P; oldProps: P }): void };

describe("particleShapeChanged", () => {
  it("is the buffer-sizing props only — not visible, palette, colour or speed", () => {
    expect(particleShapeChanged(vec(), vec({ visible: false, palette: [1], ...{ speedFactor: 9, opacity: 0 } }))).toBe(false);
    expect(particleShapeChanged(vec(), vec({ numParticles: 12000 }))).toBe(true);
    expect(particleShapeChanged(vec(), vec({ maxAge: 25 }))).toBe(true);
    expect(particleShapeChanged(vec(), vec({ width: 1.4 }))).toBe(true);
    expect(particleShapeChanged(vec(), vec({ imageType: "SCALAR" }))).toBe(true);
  });
});

describe("keep-alive updateState", () => {
  it("sets the transform up once and leaves it alone across visible flips", () => {
    const { Inner, calls } = makeInner();
    expect(patchParticleInner(Inner.prototype)).toBe(true);
    const l = new Inner() as unknown as Updatable;
    l.updateState({ props: vec(), oldProps: {} });
    expect(calls).toEqual(["super", "setup"]);
    l.updateState({ props: vec({ visible: false }), oldProps: vec() });
    l.updateState({ props: vec(), oldProps: vec({ visible: false }) });
    expect(calls).toEqual(["super", "setup", "super", "super"]);
  });

  it("rebuilds on a shape change, repalettes on a palette change, deletes when the shape is invalid", () => {
    const { Inner, calls } = makeInner();
    patchParticleInner(Inner.prototype);
    const l = new Inner() as unknown as Updatable;
    l.updateState({ props: vec(), oldProps: {} });
    calls.length = 0;
    l.updateState({ props: vec({ numParticles: 12000 }), oldProps: vec() });
    expect(calls).toEqual(["super", "setup"]);
    calls.length = 0;
    l.updateState({ props: vec({ numParticles: 12000, palette: [0] }), oldProps: vec({ numParticles: 12000 }) });
    expect(calls).toEqual(["super", "palette"]);
    calls.length = 0;
    l.updateState({ props: vec({ numParticles: 0 }), oldProps: vec({ numParticles: 12000, palette: [0] }) });
    expect(calls).toEqual(["super", "delete"]);
  });

  it("can be driven directly with an explicit parent updateState", () => {
    const { Inner, calls } = makeInner();
    const l = new Inner();
    keepAliveUpdateState.call(l, { props: vec(), oldProps: {} }, function () {
      calls.push("parent");
    });
    expect(calls).toEqual(["parent", "setup"]);
  });

  it("patches a prototype once and leaves an unfamiliar build untouched", () => {
    const { Inner } = makeInner();
    expect(patchParticleInner(Inner.prototype)).toBe(true);
    expect(patchParticleInner(Inner.prototype)).toBe(false);
    class Odd {
      updateState() {}
    }
    const before = Odd.prototype.updateState;
    expect(patchParticleInner(Odd.prototype)).toBe(false);
    expect(Odd.prototype.updateState).toBe(before);
  });
});
