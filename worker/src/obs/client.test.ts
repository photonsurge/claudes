// Unit tests for the browser-source settings policy (pure functions only — the
// websocket plumbing is exercised via the lifecycle's manual-handoff paths).
import { browserSourceFps, browserSourceSettings } from "./client";

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
