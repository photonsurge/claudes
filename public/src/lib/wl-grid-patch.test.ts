import { cachedUpdateFeatures, installGridPatch, patchGridComposite, patchGridLayer, type GridComposite, type GridFeature, gridPatchDisabled } from "./wl-grid-patch";
import { globeGridPositions, icosphereOrder, icospherePoints, type LngLat } from "./wl-grid-positions";

type Img = { id: string; valueAt: (p: LngLat) => number };

/** WeatherLayers-2026.5-shaped composite: positions from the viewport at density + 3, NaN-filtered features. */
function makeComposite() {
  let samples = 0;
  class Composite implements GridComposite {
    props: Record<string, unknown> = {};
    state: GridComposite["state"] & { positions?: LngLat[]; points?: GridFeature[] } = {};
    context: GridComposite["context"] = {};
    setState(update: object) {
      Object.assign(this.state, update);
    }
    _updatePositions() {
      const { viewport } = this.context;
      const { density } = this.props as { density?: number };
      const positions = fakePositions(viewport, (density ?? 0) + 3);
      this.setState({ positions });
      this._updateFeatures();
    }
    _updateFeatures() {
      const { image } = this.props as { image?: Img };
      const { positions } = this.state;
      if (!image || !positions) return;
      const points = positions
        .map((p) => {
          samples++;
          return { type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { value: image.valueAt(p) } };
        })
        .filter((f) => !isNaN(f.properties.value));
      this.setState({ points });
    }
  }
  return { Composite, samples: () => samples };
}
/** The Mercator stand-in WeatherLayers would use: one point per unit of t. */
const fakePositions = (viewport: unknown, t: number): LngLat[] => Array.from({ length: t }, (_, i) => [i, (viewport as { latitude?: number })?.latitude ?? 0]);

const p1: LngLat = [1, 1];
const p2: LngLat = [2, 2];
const p3: LngLat = [3, 3];
const p4: LngLat = [4, 4];
const imageA: Img = { id: "A", valueAt: (p) => (p === p3 ? NaN : p[0] * 10) };
const imageB: Img = { id: "B", valueAt: (p) => p[0] * 100 };

describe("WeatherLayers GridLayer patch", () => {
  it("patches a composite of the known shape once", () => {
    const { Composite } = makeComposite();
    expect(patchGridComposite(Composite)).toBe("patched");
    expect(patchGridComposite(Composite)).toBe("already");
  });

  it("samples each point once per image and keeps position order", () => {
    const { Composite, samples } = makeComposite();
    patchGridComposite(Composite);
    const c = new Composite();
    c.props = { image: imageA };
    c.state.positions = [p1, p2, p3];
    c._updateFeatures();
    expect(samples()).toBe(3);
    const [f1, f2] = c.state.points!;
    expect(c.state.points!.map((f) => f.properties.value)).toEqual([10, 20]);
    // Same positions again: nothing sampled, same feature objects.
    c._updateFeatures();
    expect(samples()).toBe(3);
    expect(c.state.points![0]).toBe(f1);
    // One new point: only it is sampled; the NaN point stays absent; order follows positions.
    c.state.positions = [p4, p3, p2];
    c._updateFeatures();
    expect(samples()).toBe(4);
    expect(c.state.points!.map((f) => f.properties.value)).toEqual([40, 20]);
    expect(c.state.points![1]).toBe(f2);
    // A different image empties the cache.
    c.props = { image: imageB };
    c._updateFeatures();
    expect(samples()).toBe(7);
    expect(c.state.points!.map((f) => f.properties.value)).toEqual([400, 300, 200]);
    // No image: WeatherLayers' own early return, points untouched.
    c.props = {};
    c._updateFeatures();
    expect(samples()).toBe(7);
    expect(c.state.points!.length).toBe(3);
  });

  it("hands back to the original for good when features are not built on their positions", () => {
    let samples = 0;
    class Copying implements GridComposite {
      props: Record<string, unknown> = { image: imageB };
      state: GridComposite["state"] = {};
      context = {};
      setState(u: object) {
        Object.assign(this.state, u);
      }
      _updatePositions() {
        this.setState({ positions: fakePositions(undefined, 0 + 3) });
        this._updateFeatures();
      }
      _updateFeatures() {
        const { positions } = this.state;
        if (!positions) return;
        samples++;
        const points = positions.map((p) => ({ geometry: { coordinates: [...p] as LngLat }, properties: { value: p[0] } })).filter((f) => !isNaN(f.properties.value));
        this.setState({ points });
      }
    }
    const c = new Copying();
    c.state.positions = [p1, p2];
    cachedUpdateFeatures(Copying.prototype._updateFeatures).call(c);
    expect(c.state.points!.map((f) => f.properties.value)).toEqual([1, 2]);
    expect(c.state.godsFeatureCache).toBe(false);
    cachedUpdateFeatures(Copying.prototype._updateFeatures).call(c);
    expect(samples).toBe(3);
  });

  it("takes positions from the memoised globe builder, and WeatherLayers' own elsewhere", () => {
    const { Composite } = makeComposite();
    patchGridComposite(Composite);
    const globe = {
      resolution: 2,
      scale: 2 ** 2,
      longitude: 5,
      latitude: 45,
      width: 400,
      height: 300,
      unproject: ([x, y]: number[]) => [5 + (x - 200) * 0.05, 45 - (y - 150) * 0.05],
    };
    const c = new Composite();
    c.props = { image: imageB, density: 1 };
    c.context = { viewport: globe };
    c._updatePositions();
    const expected = globeGridPositions(globe, 4);
    expect(c.state.positions).toEqual(expected);
    expect(c.state.positions!.every((p) => icospherePoints(icosphereOrder(2, 4)).includes(p))).toBe(true);
    expect(c.state.points!.length).toBe(expected.length);
    // A Mercator viewport (no resolution) keeps WeatherLayers' own positions.
    const m = new Composite();
    m.props = { image: imageB };
    m.context = { viewport: { latitude: 7 } };
    m._updatePositions();
    expect(m.state.positions).toEqual([
      [0, 7],
      [1, 7],
      [2, 7],
    ]);
  });

  it("patches the composite the layer renders, and skips unknown shapes", () => {
    const { Composite } = makeComposite();
    class Layer {
      renderLayers() {
        return [new Composite()]; // id: "composite"
      }
    }
    expect(patchGridLayer(Layer)).toBe("patched");
    expect(patchGridLayer(Layer)).toBe("already");
    new Layer().renderLayers();
    expect(patchGridComposite(Composite)).toBe("already");
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    // The jest WeatherLayers mock has no renderLayers of that shape.
    expect(installGridPatch()).toBe("skipped");
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});

describe("gridPatchDisabled", () => {
  it("is off unless the URL asks for it", () => {
    for (const s of [undefined, "", "?token=abc", "?nogrid=0", "?nogrid=false"]) {
      expect(gridPatchDisabled(s)).toBe(false);
    }
  });

  it("is on for ?nogrid, with or without a value", () => {
    for (const s of ["?nogrid=1", "?nogrid", "?nogrid=yes", "?token=abc&nogrid=1"]) {
      expect(gridPatchDisabled(s)).toBe(true);
    }
  });

  it("takes the env lever, which is what the operator can actually set", () => {
    // OBS browser sources are built from the stream config, so there is no URL
    // to edit by hand — but the deploy syncs .env.deploy.
    for (const e of ["off", "OFF", " off ", "0", "false", "no"]) {
      expect(gridPatchDisabled(undefined, e)).toBe(true);
    }
    for (const e of [undefined, "", "on", "1", "true"]) {
      expect(gridPatchDisabled(undefined, e)).toBe(false);
    }
    // Env off wins even on a plain URL; env on doesn't override an explicit URL.
    expect(gridPatchDisabled("?token=abc", "off")).toBe(true);
    expect(gridPatchDisabled("?nogrid=1", "on")).toBe(true);
  });
});
