// The page an encoder's browser source loads (crossword plan §3, §10): the
// channel's output page by kind — /watch for weather, /crossword for a
// crossword — and the scene an encoder goes back to after a run borrows it.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const scenes = new Map<string, any>();
const encoders = new Map<string, any>();
let activeRun: any = null;
const db = {
  activeRunForEncoder: jest.fn(async () => activeRun),
  getStreamEncoder: jest.fn(async (id: string) => encoders.get(id) ?? null),
  getOrInitBroadcastState: jest.fn(async () => ({ watchToken: "main-token" })),
  getScene: jest.fn(async (id: string) => scenes.get(id) ?? null),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { borrowingRun, encoderOwnSceneId, watchUrlForScene, withEncoderLock } from "./encoders";

beforeEach(() => {
  activeRun = null;
  scenes.clear();
  encoders.clear();
  process.env.PUBLIC_BASE_URL = "https://wx.example";
});
afterAll(() => {
  delete process.env.PUBLIC_BASE_URL;
});

describe("watchUrlForScene", () => {
  it("builds a weather channel's /watch URL with its token", async () => {
    scenes.set("atlantic", { id: "atlantic", surface: "globe", watchToken: "a-tok" });
    await expect(watchUrlForScene("atlantic")).resolves.toBe("https://wx.example/watch/atlantic?token=a-tok");
  });

  it("treats a channel saved before `surface` existed as weather", async () => {
    scenes.set("old", { id: "old", watchToken: "o-tok" });
    await expect(watchUrlForScene("old")).resolves.toBe("https://wx.example/watch/old?token=o-tok");
  });

  it("builds a crossword channel's /crossword URL with its token", async () => {
    scenes.set("daily", { id: "daily", surface: "crossword", watchToken: "c-tok" });
    await expect(watchUrlForScene("daily")).resolves.toBe("https://wx.example/crossword/daily?token=c-tok");
  });

  it("the main channel is always weather", async () => {
    await expect(watchUrlForScene("default")).resolves.toBe("https://wx.example/watch/default?token=main-token");
  });

  it("escapes the id", async () => {
    scenes.set("a b", { id: "a b", surface: "crossword", watchToken: "t" });
    await expect(watchUrlForScene("a b")).resolves.toBe("https://wx.example/crossword/a%20b?token=t");
  });
});

describe("encoderOwnSceneId", () => {
  it("is the encoder's bound channel", async () => {
    encoders.set("gpu-1", { id: "gpu-1", sceneId: "volcano", enabled: true });
    await expect(encoderOwnSceneId("gpu-1")).resolves.toBe("volcano");
  });

  it("is the main channel for the env encoder (the legacy single OBS)", async () => {
    await expect(encoderOwnSceneId(undefined)).resolves.toBe("default");
    await expect(encoderOwnSceneId("env")).resolves.toBe("default");
  });

  it("is null for a registered encoder bound to no channel (it idles, no main globe)", async () => {
    encoders.set("gpu-2", { id: "gpu-2", enabled: true });
    await expect(encoderOwnSceneId("gpu-2")).resolves.toBeNull();
  });

  it("is null for a video encoder (it idles on a blank page)", async () => {
    encoders.set("obs-v1", { id: "obs-v1", use: "videos", enabled: true });
    await expect(encoderOwnSceneId("obs-v1")).resolves.toBeNull();
  });
});

describe("borrowingRun", () => {
  it("is the active run when it shows another channel on the encoder", async () => {
    encoders.set("gpu-1", { id: "gpu-1", sceneId: "volcano", enabled: true });
    activeRun = { id: "r1", sceneId: "daily", encoderId: "gpu-1" };
    await expect(borrowingRun("gpu-1")).resolves.toMatchObject({ id: "r1" });
  });

  it("is null for a run on the encoder's own channel, or no run", async () => {
    encoders.set("gpu-1", { id: "gpu-1", sceneId: "volcano", enabled: true });
    await expect(borrowingRun("gpu-1")).resolves.toBeNull();
    activeRun = { id: "r1", sceneId: "volcano", encoderId: "gpu-1" };
    await expect(borrowingRun("gpu-1")).resolves.toBeNull();
  });
});

describe("withEncoderLock", () => {
  it("runs one change at a time per encoder, in order, and survives a failure", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withEncoderLock("gpu-1", async () => {
      order.push("a-start");
      await new Promise<void>((r) => (release = r));
      order.push("a-end");
    });
    const failing = withEncoderLock("gpu-1", async () => {
      order.push("b");
      throw new Error("boom");
    });
    const third = withEncoderLock("gpu-1", async () => void order.push("c"));
    const other = withEncoderLock("gpu-2", async () => void order.push("other"));
    await other;
    expect(order).toEqual(["a-start", "other"]);
    release();
    await first;
    await expect(failing).rejects.toThrow("boom");
    await third;
    expect(order).toEqual(["a-start", "other", "a-end", "b", "c"]);
  });
});
