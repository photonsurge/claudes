// Where an encoder points during and after a video render (short-video plan
// §6.4, §13): the script's scene during, its own channel after for a channel
// encoder, and a blank idle page for a video encoder — NEVER the main channel.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const encoders = new Map<string, any>();
const db = {
  getStreamEncoder: jest.fn(async (id: string) => encoders.get(id) ?? null),
  getOrInitBroadcastState: jest.fn(async () => ({ watchToken: "main-token" })),
  getScene: jest.fn(async (id: string) => ({ id, watchToken: `${id}-token` })),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

jest.mock("../obs/client", () => {
  class ObsUnavailableError extends Error {}
  return {
    ObsUnavailableError,
    envEndpoint: () => null,
    refreshBrowserSource: jest.fn(),
    provisionBrowserScene: jest.fn(async (_ep: unknown, o: { sceneName: string; inputName: string }) => ({
      sceneName: o.sceneName,
      inputName: o.inputName,
      width: 1920,
      height: 1080,
      created: false,
      recreated: false,
      switched: true,
      refreshed: true,
      removedInputs: [],
      removedScenes: [],
    })),
  };
});

import { provisionBrowserScene } from "../obs/client";
import { idleEncoderScene, provisionEncoderScene, restoreEncoderScene } from "./encoders";

const lastProvision = () => (provisionBrowserScene as jest.Mock).mock.calls.at(-1)![1];

beforeEach(() => {
  encoders.clear();
  jest.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://wx.example";
});
afterAll(() => {
  delete process.env.PUBLIC_BASE_URL;
});

describe("provisionEncoderScene with a scene override", () => {
  it("points a channel encoder at the script's scene instead of its binding", async () => {
    encoders.set("gpu-1", { id: "gpu-1", url: "ws://gpu:1", enabled: true, sceneId: "volcano" });
    const res = await provisionEncoderScene("gpu-1", { sceneId: "shorts" });
    expect(res.sceneId).toBe("shorts");
    expect(lastProvision()).toMatchObject({ url: "https://wx.example/watch/shorts?token=shorts-token", sceneName: "PhotonSurge — shorts" });
  });

  it("without one, still shows the encoder's own bound scene (channel runs unchanged)", async () => {
    encoders.set("gpu-1", { id: "gpu-1", url: "ws://gpu:1", enabled: true, sceneId: "volcano" });
    await provisionEncoderScene("gpu-1");
    expect(lastProvision().url).toBe("https://wx.example/watch/volcano?token=volcano-token");
  });
});

describe("restoreEncoderScene", () => {
  it("a VIDEO encoder goes idle on a blank page, swept — not re-provisioned to the main channel", async () => {
    encoders.set("obs-v1", { id: "obs-v1", url: "ws://v:1", enabled: true, use: "videos" });
    const res = await restoreEncoderScene("obs-v1");
    expect(res).toEqual({ idle: true, url: "about:blank" });
    const call = lastProvision();
    expect(call).toMatchObject({ url: "about:blank", sceneName: "PhotonSurge — idle", prune: true });
    expect(call.url).not.toMatch(/\/watch\//);
    expect(db.getOrInitBroadcastState).not.toHaveBeenCalled(); // the main channel is never consulted
  });

  it("a CHANNEL encoder gets its own scene back", async () => {
    encoders.set("gpu-1", { id: "gpu-1", url: "ws://gpu:1", enabled: true, sceneId: "volcano", use: "channels" });
    expect(await restoreEncoderScene("gpu-1")).toEqual({ idle: false, url: "https://wx.example/watch/volcano?token=volcano-token" });
  });

  it("an unbound channel encoder falls back to the main channel, as before", async () => {
    encoders.set("gpu-2", { id: "gpu-2", url: "ws://gpu:2", enabled: true });
    expect((await restoreEncoderScene("gpu-2")).url).toBe("https://wx.example/watch/default?token=main-token");
  });

  it("idleEncoderScene works for any encoder", async () => {
    encoders.set("gpu-3", { id: "gpu-3", url: "ws://gpu:3", enabled: true });
    expect((await idleEncoderScene("gpu-3")).url).toBe("about:blank");
  });
});
