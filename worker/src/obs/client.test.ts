// Unit tests for the browser-source settings policy (pure functions only — the
// websocket plumbing is exercised via the lifecycle's manual-handoff paths).
import { browserSourceFps, browserSourceSettings, outputInFlight, redactObsValue, summarizeObsValue } from "./client";

const BASE = { url: "http://localhost:10100/watch/main?token=t", width: 1920, height: 1080 };

beforeEach(() => {
  delete process.env.OBS_BROWSER_FPS;
});

describe("browserSourceFps", () => {
  it("defaults to 30 and honours a sane OBS_BROWSER_FPS override", () => {
    expect(browserSourceFps()).toBe(30);
    process.env.OBS_BROWSER_FPS = "60";
    expect(browserSourceFps()).toBe(60);
  });

  it("falls back to 30 on garbage or out-of-range values", () => {
    for (const v of ["abc", "", "0", "5", "144", "-30"]) {
      process.env.OBS_BROWSER_FPS = v;
      expect(browserSourceFps()).toBe(30);
    }
  });
});

describe("browserSourceSettings", () => {
  it("creates a source with the full perf defaults", () => {
    expect(browserSourceSettings(BASE)).toEqual({
      ...BASE,
      reroute_audio: true,
      fps_custom: true,
      fps: 30,
      shutdown: false,
      restart_when_active: false,
    });
  });

  it("applies defaults on update when the source has never had them set", () => {
    // A legacy auto-provisioned source only ever stored url/size/audio.
    const existing = { url: "http://old", width: 1920, height: 1080, reroute_audio: true };
    expect(browserSourceSettings(BASE, existing)).toMatchObject({
      fps_custom: true,
      fps: 30,
      shutdown: false,
      restart_when_active: false,
    });
  });

  it("leaves an operator-owned frame rate alone (the fps pair travels together)", () => {
    const out = browserSourceSettings(BASE, { fps_custom: true, fps: 60 });
    expect(out).not.toHaveProperty("fps");
    expect(out).not.toHaveProperty("fps_custom");
    // Untouched keys still get their defaults.
    expect(out).toMatchObject({ shutdown: false, restart_when_active: false });
  });

  it("respects an explicit operator choice on the visibility flags", () => {
    const out = browserSourceSettings(BASE, { shutdown: true, restart_when_active: true });
    expect(out).not.toHaveProperty("shutdown");
    expect(out).not.toHaveProperty("restart_when_active");
    expect(out).toMatchObject({ fps_custom: true, fps: 30 });
  });

  it("always enforces url/size/reroute_audio — runs depend on them", () => {
    const out = browserSourceSettings(BASE, { reroute_audio: false, url: "http://stale" });
    expect(out).toMatchObject({ ...BASE, reroute_audio: true });
  });
});

describe("websocket traffic log helpers", () => {
  it("redacts the stream key + passwords at any depth, keeps everything else", () => {
    const out = redactObsValue({
      streamServiceType: "rtmp_custom",
      streamServiceSettings: { server: "rtmp://a.rtmp.youtube.com/live2", key: "abcd-efgh-ijkl", use_auth: false },
      password: "hunter2",
      list: [{ key: "x" }],
    }) as any;
    expect(out.streamServiceSettings.server).toBe("rtmp://a.rtmp.youtube.com/live2");
    expect(out.streamServiceSettings.key).toBe("…ijkl");
    expect(out.streamServiceSettings.use_auth).toBe(false);
    expect(out.password).toBe("…ter2");
    expect(out.list[0].key).toBe("…");
    expect(JSON.stringify(out)).not.toContain("abcd-efgh");
  });

  it("passes primitives / undefined through and bounds long values", () => {
    expect(redactObsValue(undefined)).toBeUndefined();
    expect(redactObsValue("x")).toBe("x");
    expect(summarizeObsValue(undefined)).toBe("");
    expect(summarizeObsValue({ a: 1 })).toBe('{"a":1}');
    const big = summarizeObsValue({ scenes: Array.from({ length: 200 }, (_, i) => ({ sceneName: `scene ${i}` })) }, 50);
    expect(big.length).toBeLessThan(90);
    expect(big).toMatch(/…\(\d+ chars\)$/);
  });

  it("treats STARTING/RECONNECTING as in flight, STARTED/STOPPED as settled", () => {
    const st = (outputState: string) => ({ outputActive: false, outputState, at: 0 });
    expect(outputInFlight(undefined)).toBe(false);
    expect(outputInFlight(st("OBS_WEBSOCKET_OUTPUT_STARTING"))).toBe(true);
    expect(outputInFlight(st("OBS_WEBSOCKET_OUTPUT_RECONNECTING"))).toBe(true);
    expect(outputInFlight(st("OBS_WEBSOCKET_OUTPUT_STOPPED"))).toBe(false);
    expect(outputInFlight(st("OBS_WEBSOCKET_OUTPUT_STARTED"))).toBe(false);
  });
});
