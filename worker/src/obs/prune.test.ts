// The instance sweep: an OBS that has accumulated three channels' globes must come
// out of a provision running exactly one page, without an operator's own sources
// or the program scene being collateral damage.
import type OBSWebSocket from "obs-websocket-js";
import { isWatchUrl, pruneForeignInputs, pruneForeignScenes, pruneEnabled, sweepInputs, sweepScenes } from "./prune";

const CANON = "PhotonSurge globe — weather";
const SCENE = "PhotonSurge — weather";

class ObsError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

interface FakeInput {
  inputName: string;
  inputKind: string;
  url?: string;
}

/** In-memory OBS holding scenes (name → source names) and inputs. */
function fakeObs(inputs: FakeInput[], scenes: Record<string, string[]>, programScene: string) {
  const byName = new Map(inputs.map((i) => [i.inputName, i]));
  const sceneMap = new Map(Object.entries(scenes));
  const calls: Array<[string, unknown]> = [];
  const call = async (type: string, data?: Record<string, unknown>) => {
    calls.push([type, data]);
    switch (type) {
      case "GetInputList":
        return { inputs: [...byName.values()].map(({ inputName, inputKind }) => ({ inputName, inputKind })) };
      case "GetInputSettings": {
        const i = byName.get(String(data?.inputName));
        if (!i) throw new ObsError(600, "No source was found");
        return { inputSettings: i.url ? { url: i.url } : {} };
      }
      case "RemoveInput": {
        const n = String(data?.inputName);
        if (!byName.has(n)) throw new ObsError(600, "No source was found");
        byName.delete(n);
        for (const [s, names] of sceneMap) sceneMap.set(s, names.filter((x) => x !== n));
        return {};
      }
      case "GetSceneList":
        return {
          currentProgramSceneName: programScene,
          scenes: [...sceneMap.keys()].map((sceneName) => ({ sceneName })),
        };
      case "RemoveScene": {
        const n = String(data?.sceneName);
        if (!sceneMap.has(n)) throw new ObsError(600, "No scene was found");
        sceneMap.delete(n);
        return {};
      }
      default:
        throw new Error(`unexpected call ${type}`);
    }
  };
  return { obs: { call } as unknown as OBSWebSocket, inputNames: () => [...byName.keys()], sceneNames: () => [...sceneMap.keys()], calls };
}

describe("isWatchUrl", () => {
  it("matches a /watch page on any host, tokened or not", () => {
    expect(isWatchUrl("https://gods.example/watch/weather?token=abc")).toBe(true);
    expect(isWatchUrl("http://localhost:10100/watch/main")).toBe(true);
    expect(isWatchUrl("/watch/volcano")).toBe(true);
  });
  it("rejects other pages and non-strings", () => {
    expect(isWatchUrl("https://gods.example/control")).toBe(false);
    expect(isWatchUrl("https://gods.example/watchlist")).toBe(false);
    expect(isWatchUrl(undefined)).toBe(false);
    expect(isWatchUrl(42)).toBe(false);
  });
});

describe("sweepInputs", () => {
  it("keeps this channel's globe and its rebuild siblings, marks other channels stale", () => {
    const s = sweepInputs(
      [
        { inputName: CANON, inputKind: "browser_source" },
        { inputName: `${CANON} #2`, inputKind: "browser_source" },
        { inputName: "PhotonSurge globe — volcano", inputKind: "browser_source" },
        { inputName: "PhotonSurge globe — main", inputKind: "browser_source" },
      ],
      CANON,
    );
    expect(s.keep).toEqual([CANON, `${CANON} #2`]);
    expect(s.stale).toEqual(["PhotonSurge globe — volcano", "PhotonSurge globe — main"]);
  });

  it("routes foreign browser sources to candidates and leaves other kinds alone", () => {
    const s = sweepInputs(
      [
        { inputName: "Operator overlay", inputKind: "browser_source" },
        { inputName: "Desktop Audio", inputKind: "pulse_output_capture" },
        { inputName: "Sting", inputKind: "ffmpeg_source" },
      ],
      CANON,
    );
    expect(s.candidates).toEqual(["Operator overlay"]);
    expect(s.foreign).toEqual(["Desktop Audio", "Sting"]);
    expect(s.stale).toEqual([]);
  });
});

describe("sweepScenes", () => {
  it("removes our other channels' scenes only", () => {
    const names = [SCENE, "PhotonSurge — volcano", "PhotonSurge — main", "Operator BRB"];
    expect(sweepScenes(names, SCENE, SCENE)).toEqual(["PhotonSurge — volcano", "PhotonSurge — main"]);
  });

  it("never removes the current program scene", () => {
    const names = [SCENE, "PhotonSurge — volcano"];
    expect(sweepScenes(names, SCENE, "PhotonSurge — volcano")).toEqual([]);
  });
});

describe("pruneForeignInputs", () => {
  it("sweeps other channels' globes and hand-made /watch sources, keeping ours and the operator's", async () => {
    const f = fakeObs(
      [
        { inputName: CANON, inputKind: "browser_source", url: "https://x/watch/weather" },
        { inputName: "PhotonSurge globe — volcano", inputKind: "browser_source", url: "https://x/watch/volcano" },
        { inputName: "old globe copy", inputKind: "browser_source", url: "https://x/watch/main?token=t" },
        { inputName: "Sponsor overlay", inputKind: "browser_source", url: "https://sponsor.example/lower-third" },
        { inputName: "Desktop Audio", inputKind: "pulse_output_capture" },
      ],
      { [SCENE]: [CANON] },
      SCENE,
    );

    const removed = await pruneForeignInputs(f.obs, CANON);

    expect(removed.sort()).toEqual(["PhotonSurge globe — volcano", "old globe copy"]);
    expect(f.inputNames().sort()).toEqual(["Desktop Audio", CANON, "Sponsor overlay"].sort());
  });

  it("survives a source vanishing mid-sweep", async () => {
    const f = fakeObs(
      [
        { inputName: CANON, inputKind: "browser_source" },
        { inputName: "PhotonSurge globe — main", inputKind: "browser_source" },
      ],
      { [SCENE]: [CANON] },
      SCENE,
    );
    const raw = f.obs.call.bind(f.obs) as (t: string, d?: unknown) => Promise<unknown>;
    (f.obs as { call: unknown }).call = async (t: string, d?: Record<string, unknown>) => {
      if (t === "RemoveInput") throw new ObsError(600, "No source was found");
      return raw(t, d);
    };

    await expect(pruneForeignInputs(f.obs, CANON)).resolves.toEqual([]);
  });
});

describe("pruneForeignScenes", () => {
  it("removes our other scenes but not the kept scene or an operator's", async () => {
    const f = fakeObs(
      [{ inputName: CANON, inputKind: "browser_source" }],
      { [SCENE]: [CANON], "PhotonSurge — volcano": [], "PhotonSurge — main": [], "Operator BRB": [] },
      SCENE,
    );

    const removed = await pruneForeignScenes(f.obs, SCENE);

    expect(removed).toEqual(["PhotonSurge — volcano", "PhotonSurge — main"]);
    expect(f.sceneNames().sort()).toEqual([SCENE, "Operator BRB"].sort());
  });
});

describe("pruneEnabled", () => {
  const prev = process.env.OBS_PRUNE;
  afterEach(() => {
    if (prev === undefined) delete process.env.OBS_PRUNE;
    else process.env.OBS_PRUNE = prev;
  });

  it("is on by default and off only for OBS_PRUNE=off", () => {
    delete process.env.OBS_PRUNE;
    expect(pruneEnabled()).toBe(true);
    process.env.OBS_PRUNE = "on";
    expect(pruneEnabled()).toBe(true);
    process.env.OBS_PRUNE = "OFF";
    expect(pruneEnabled()).toBe(false);
  });
});
