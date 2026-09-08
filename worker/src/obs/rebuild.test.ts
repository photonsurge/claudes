// The hard-reset rebuild against a fake OBS that frees removed sources LATE —
// the real obs-websocket behaviour that made RemoveInput → CreateInput fail with
// "A source already exists by that input name" and left the scene blank.
import type OBSWebSocket from "obs-websocket-js";
import {
  isAlreadyExists,
  isNotFound,
  isOurInput,
  nextSiblingName,
  ourInputs,
  pickLiveInput,
  rebuildBrowserInput,
} from "./rebuild";

const CANON = "PhotonSurge globe — weather";
const SCENE = "PhotonSurge — weather";
const SETTINGS = { url: "https://x/watch/weather?token=t", width: 1920, height: 1080 };

class ObsError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * In-memory OBS: `linger` = how many GetInputList polls a removed source stays
 * listed (and name-taken) for after RemoveInput. `Infinity` = never freed.
 */
function fakeObs(initial: string[], linger: number, opts?: { inScene?: string[] }) {
  const names = new Set(initial);
  const removed = new Map<string, number>(); // name → polls left until freed
  const calls: Array<[string, unknown]> = [];
  const tick = () => {
    for (const [n, left] of [...removed]) {
      if (left <= 1) {
        removed.delete(n);
        names.delete(n);
      } else removed.set(n, left - 1);
    }
  };
  const call = async (type: string, data?: Record<string, unknown>) => {
    calls.push([type, data]);
    switch (type) {
      case "GetInputList":
        tick();
        return { inputs: [...names].map((inputName) => ({ inputName })) };
      case "RemoveInput": {
        const n = String(data?.inputName);
        if (!names.has(n)) throw new ObsError(600, `No source was found by the name of \`${n}\`.`);
        if (!removed.has(n)) removed.set(n, linger);
        return {};
      }
      case "CreateInput": {
        const n = String(data?.inputName);
        if (names.has(n)) throw new ObsError(601, "A source already exists by that input name.");
        names.add(n);
        return { inputUuid: "u", sceneItemId: 1 };
      }
      case "GetSceneItemList":
        return { sceneItems: (opts?.inScene ?? []).map((sourceName) => ({ sourceName })) };
      default:
        throw new Error(`unexpected ${type}`);
    }
  };
  const obs = { call } as unknown as OBSWebSocket;
  const of = (type: string) => calls.filter(([t]) => t === type);
  return { obs, names, calls, of };
}

describe("name helpers", () => {
  it("recognises the canonical name and its numbered siblings only", () => {
    expect(isOurInput(CANON, CANON)).toBe(true);
    expect(isOurInput(`${CANON} #2`, CANON)).toBe(true);
    expect(isOurInput(`${CANON} #10`, CANON)).toBe(true);
    expect(isOurInput(`${CANON} #0`, CANON)).toBe(false);
    expect(isOurInput(`${CANON} #x`, CANON)).toBe(false);
    expect(isOurInput(`${CANON} (copy)`, CANON)).toBe(false);
    expect(isOurInput("PhotonSurge globe — weather2", CANON)).toBe(false);
    expect(isOurInput("PhotonSurge globe — seismic", CANON)).toBe(false);
  });

  it("lists ours canonical-first then by number, ignoring the operator's own sources", () => {
    const names = ["Mic", `${CANON} #10`, "PhotonSurge globe — seismic", `${CANON} #2`, CANON, "My globe"];
    expect(ourInputs(names, CANON)).toEqual([CANON, `${CANON} #2`, `${CANON} #10`]);
    expect(ourInputs(["Mic"], CANON)).toEqual([]);
  });

  it("picks the first free sibling number", () => {
    expect(nextSiblingName([CANON], CANON)).toBe(`${CANON} #2`);
    expect(nextSiblingName([CANON, `${CANON} #2`, `${CANON} #3`], CANON)).toBe(`${CANON} #4`);
  });

  it("classifies obs-websocket errors by code or message", () => {
    expect(isAlreadyExists(new ObsError(601, "A source already exists by that input name."))).toBe(true);
    expect(isAlreadyExists(new Error("A source already exists by that input name."))).toBe(true);
    expect(isAlreadyExists(new ObsError(600, "nope"))).toBe(false);
    expect(isNotFound(new ObsError(600, "No source was found by the name of `x`."))).toBe(true);
    expect(isNotFound(new Error("random"))).toBe(false);
  });
});

describe("pickLiveInput", () => {
  it("prefers the one that actually has a scene item (a lingering ghost has none)", async () => {
    const { obs } = fakeObs([CANON, `${CANON} #2`], 0, { inScene: [`${CANON} #2`, "Mic"] });
    expect(await pickLiveInput(obs, SCENE, [CANON, `${CANON} #2`])).toBe(`${CANON} #2`);
  });

  it("falls back to canonical-first without a scene-item lookup for a single candidate", async () => {
    const { obs, of } = fakeObs([CANON], 0);
    expect(await pickLiveInput(obs, SCENE, [CANON])).toBe(CANON);
    expect(of("GetSceneItemList")).toHaveLength(0);
    expect(await pickLiveInput(obs, SCENE, [])).toBeUndefined();
  });
});

describe("rebuildBrowserInput", () => {
  it("waits for OBS to release the name, then recreates under the canonical name — no failed create", async () => {
    const { obs, names, of } = fakeObs([CANON, "Mic"], 3);
    const r = await rebuildBrowserInput(obs, {
      sceneName: SCENE,
      inputName: CANON,
      existing: [CANON],
      inputSettings: SETTINGS,
      pollMs: 1,
    });
    expect(r).toMatchObject({ inputName: CANON, fallback: false });
    expect(of("RemoveInput")).toHaveLength(1);
    // Exactly one CreateInput, and it succeeded — the old code fired it straight
    // after RemoveInput and got 601 (the bug).
    expect(of("CreateInput")).toHaveLength(1);
    expect(of("CreateInput")[0][1]).toMatchObject({
      sceneName: SCENE,
      inputName: CANON,
      inputKind: "browser_source",
      inputSettings: SETTINGS,
      sceneItemEnabled: true,
    });
    expect(of("GetInputList").length).toBeGreaterThanOrEqual(3);
    expect([...names]).toEqual(["Mic", CANON]);
  });

  it("recreates immediately when OBS frees the source at once", async () => {
    const { obs, of } = fakeObs([CANON], 1);
    const r = await rebuildBrowserInput(obs, { sceneName: SCENE, inputName: CANON, existing: [CANON], inputSettings: SETTINGS, pollMs: 1 });
    expect(r.fallback).toBe(false);
    expect(of("GetInputList")).toHaveLength(1);
  });

  it("falls back to a numbered sibling when OBS never lets go, so the scene is not left empty", async () => {
    const { obs, names } = fakeObs([CANON], Number.POSITIVE_INFINITY);
    const r = await rebuildBrowserInput(obs, {
      sceneName: SCENE,
      inputName: CANON,
      existing: [CANON],
      inputSettings: SETTINGS,
      settleMs: 20,
      pollMs: 1,
    });
    expect(r).toMatchObject({ inputName: `${CANON} #2`, fallback: true });
    expect(r.waitedMs).toBeGreaterThanOrEqual(20);
    expect(names.has(`${CANON} #2`)).toBe(true);
  });

  it("sweeps a leftover sibling AND the canonical ghost, skipping taken sibling numbers on fallback", async () => {
    const { obs, of } = fakeObs([CANON, `${CANON} #2`], Number.POSITIVE_INFINITY);
    const r = await rebuildBrowserInput(obs, {
      sceneName: SCENE,
      inputName: CANON,
      existing: [CANON, `${CANON} #2`],
      inputSettings: SETTINGS,
      settleMs: 0,
      pollMs: 1,
    });
    expect(of("RemoveInput").map(([, d]) => (d as { inputName: string }).inputName)).toEqual([CANON, `${CANON} #2`]);
    expect(r).toMatchObject({ inputName: `${CANON} #3`, fallback: true });
  });

  it("tolerates a source that vanished before RemoveInput reached it", async () => {
    const { obs } = fakeObs(["Mic"], 0);
    const r = await rebuildBrowserInput(obs, { sceneName: SCENE, inputName: CANON, existing: [CANON], inputSettings: SETTINGS, pollMs: 1 });
    expect(r).toMatchObject({ inputName: CANON, fallback: false });
  });

  it("keeps waiting when the list says free but CreateInput still clashes, and rethrows other errors", async () => {
    // List frees one poll BEFORE the by-name lookup does.
    const { obs, of } = fakeObs([CANON], 2);
    let clashOnce = true;
    const raw = obs.call.bind(obs) as (t: string, d?: unknown) => Promise<unknown>;
    (obs as unknown as { call: unknown }).call = async (t: string, d?: unknown) => {
      if (t === "CreateInput" && clashOnce) {
        clashOnce = false;
        throw new ObsError(601, "A source already exists by that input name.");
      }
      return raw(t, d);
    };
    const r = await rebuildBrowserInput(obs, { sceneName: SCENE, inputName: CANON, existing: [CANON], inputSettings: SETTINGS, pollMs: 1 });
    expect(r.fallback).toBe(false);
    expect(of("CreateInput").length).toBeGreaterThanOrEqual(1);

    const bad = fakeObs([], 0);
    (bad.obs as unknown as { call: unknown }).call = async (t: string) => {
      if (t === "GetInputList") return { inputs: [] };
      throw new ObsError(500, "Your request is bad.");
    };
    await expect(
      rebuildBrowserInput(bad.obs, { sceneName: SCENE, inputName: CANON, existing: [], inputSettings: SETTINGS, pollMs: 1 }),
    ).rejects.toThrow(/request is bad/);
  });
});
