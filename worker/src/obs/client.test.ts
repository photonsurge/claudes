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

  it("always restamps the managed keys, even over previously stored values", () => {
    // Central tuning must WIN: bumping OBS_BROWSER_FPS applies on the next
    // provision even to a source that was created back when the default was 30.
    process.env.OBS_BROWSER_FPS = "60";
    const existing = {
      url: "http://stale",
      reroute_audio: false,
      fps_custom: true,
      fps: 30,
      shutdown: true,
      restart_when_active: true,
    };
    expect(browserSourceSettings(BASE, existing)).toEqual({
      ...BASE,
      reroute_audio: true,
      fps_custom: true,
      fps: 60,
      shutdown: false,
      restart_when_active: false,
    });
  });

  it("carries unmanaged primitive tweaks (css…) forward across a recreate", () => {
    const out = browserSourceSettings(BASE, { css: "body{background:#000}", zoom: 2, is_local_file: false });
    expect(out).toMatchObject({ css: "body{background:#000}", zoom: 2, is_local_file: false });
  });

  it("drops non-primitive unmanaged values and never lets existing override managed keys", () => {
    const out = browserSourceSettings(BASE, { weird: { nested: 1 }, list: [1, 2], width: 640 });
    expect(out).not.toHaveProperty("weird");
    expect(out).not.toHaveProperty("list");
    expect(out.width).toBe(1920);
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
