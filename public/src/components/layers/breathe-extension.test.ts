import { BREATHE, BreatheExtension, breatheModule, breatheUniforms, breatheWave, type BreatheSpec } from "./breathe-extension";

const GAMMA = (x: number) => Math.pow(x, 1 / 2.2);

describe("breatheUniforms", () => {
  const spec: BreatheSpec = { periodMs: 1000, alpha: [0.25, 1], size: [1, 3] };

  it("sits at the trough at phase 0, the peak at the half period, back at the trough at the end", () => {
    expect(breatheUniforms(spec, 0)).toEqual({ alpha: GAMMA(0.25), size: 1 });
    const peak = breatheUniforms(spec, 500);
    expect(peak.alpha).toBeCloseTo(1);
    expect(peak.size).toBeCloseTo(3);
    const back = breatheUniforms(spec, 1000);
    expect(back.alpha).toBeCloseTo(GAMMA(0.25));
    expect(back.size).toBeCloseTo(1);
  });

  it("ping is a sawtooth: rises through the period and snaps back", () => {
    const ping: BreatheSpec = { periodMs: 1000, wave: "ping", alpha: [1, 0], size: [1, 6] };
    expect(breatheUniforms(ping, 250).size).toBeCloseTo(2.25);
    expect(breatheUniforms(ping, 250).alpha).toBeCloseTo(GAMMA(0.75));
    expect(breatheUniforms(ping, 999).size).toBeCloseTo(5.995);
    expect(breatheUniforms(ping, 1000).size).toBeCloseTo(1);
  });

  it("ramp runs 0→1 once from startMs over periodMs and holds", () => {
    const ramp: BreatheSpec = { periodMs: 700, wave: "ramp", startMs: 10_000, alpha: [0, 1] };
    expect(breatheWave(ramp, 9_000)).toBe(0);
    expect(breatheWave(ramp, 10_350)).toBeCloseTo(0.5);
    expect(breatheWave(ramp, 10_700)).toBe(1);
    expect(breatheWave(ramp, 99_999)).toBe(1);
    expect(breatheUniforms(ramp, 10_350).alpha).toBeCloseTo(GAMMA(0.5));
  });

  it("a finished ramp stops asking deck for frames; a running one keeps asking", () => {
    const setShaderModuleProps = jest.fn();
    const setNeedsRedraw = jest.fn();
    const running = { props: { breathe: { periodMs: 700, wave: "ramp", startMs: Date.now(), alpha: [0, 1] } }, setShaderModuleProps, setNeedsRedraw };
    BREATHE.draw.call(running as never);
    expect(setNeedsRedraw).toHaveBeenCalledTimes(1);
    const done = { props: { breathe: { periodMs: 700, wave: "ramp", startMs: Date.now() - 5000, alpha: [0, 1] } }, setShaderModuleProps, setNeedsRedraw };
    BREATHE.draw.call(done as never);
    expect(setNeedsRedraw).toHaveBeenCalledTimes(1);
    expect(setShaderModuleProps).toHaveBeenLastCalledWith({ breathe: { alpha: 1, size: 1 } });
  });

  it("leaves a channel alone when its range is omitted", () => {
    expect(breatheUniforms({ periodMs: 1000, alpha: [0.5, 1] }, 500).size).toBe(1);
    expect(breatheUniforms({ periodMs: 1000, size: [1, 2] }, 500).alpha).toBe(1);
  });

  it("applies deck's opacity gamma so the look matches the old opacity prop", () => {
    expect(breatheUniforms({ periodMs: 10, alpha: [0.5, 0.5] }, 0).alpha).toBeCloseTo(GAMMA(0.5));
  });

  it("is negative-time safe", () => {
    expect(breatheUniforms(spec, -500).alpha).toBeCloseTo(1);
  });
});

describe("BreatheExtension", () => {
  it("injects the alpha and size hooks through one uniform block", () => {
    const shaders = new BreatheExtension().getShaders();
    expect(shaders.modules).toEqual([breatheModule]);
    expect(breatheModule.inject["fs:DECKGL_FILTER_COLOR"]).toMatch(/color\.a \*= breathe\.alpha/);
    expect(breatheModule.inject["vs:DECKGL_FILTER_SIZE"]).toMatch(/size \*= breathe\.size/);
    expect(breatheModule.vs).toMatch(/uniform breatheUniforms/);
    expect(breatheModule.uniformTypes).toEqual({ alpha: "f32", size: "f32" });
  });

  it("declares `breathe` as a default prop so composite layers forward it to sublayers", () => {
    expect(BreatheExtension.defaultProps).toEqual({ breathe: null });
  });

  it("draw writes the clock uniforms onto the layer and asks for the next frame", () => {
    const setShaderModuleProps = jest.fn();
    const setNeedsRedraw = jest.fn();
    const layer = { props: { breathe: { periodMs: 1000, alpha: [0.5, 1] } }, setShaderModuleProps, setNeedsRedraw };
    BREATHE.draw.call(layer as never);
    expect(setShaderModuleProps).toHaveBeenCalledTimes(1);
    const arg = setShaderModuleProps.mock.calls[0][0] as { breathe: { alpha: number; size: number } };
    expect(arg.breathe.alpha).toBeGreaterThan(0);
    expect(arg.breathe.alpha).toBeLessThanOrEqual(1);
    expect(arg.breathe.size).toBe(1);
    expect(setNeedsRedraw).toHaveBeenCalledTimes(1);
  });

  it("draw resets to identity and stops asking for frames when a layer has no breathe spec", () => {
    const setShaderModuleProps = jest.fn();
    const setNeedsRedraw = jest.fn();
    BREATHE.draw.call({ props: {}, setShaderModuleProps, setNeedsRedraw } as never);
    expect(setShaderModuleProps).toHaveBeenCalledWith({ breathe: { alpha: 1, size: 1 } });
    expect(setNeedsRedraw).not.toHaveBeenCalled();
  });
});
