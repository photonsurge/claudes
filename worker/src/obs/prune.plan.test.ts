// Plan-written (crossword plan §3 "three small things", §12 "worker (going
// live)"): the OBS sweep recognises "one of ours" by the page a browser source
// loads. A crossword channel's page is /crossword/<id>, so a left-over crossword
// source must be swept exactly as a left-over /watch one is; anything else an
// operator built is left alone.
import type OBSWebSocket from "obs-websocket-js";
import { isWatchUrl, pruneForeignInputs, sweepInputs } from "./prune";

/** A fake OBS: inputs with their kind and URL, recording every call. */
function fakeObs(inputs: { inputName: string; inputKind: string; url?: string }[]) {
  const byName = new Map(inputs.map((i) => [i.inputName, i]));
  const call = jest.fn(async (type: string, data?: Record<string, unknown>) => {
    switch (type) {
      case "GetInputList":
        return { inputs: [...byName.values()].map(({ inputName, inputKind }) => ({ inputName, inputKind })) };
      case "GetInputSettings": {
        const i = byName.get(String(data?.inputName));
        if (!i) throw Object.assign(new Error("No source was found"), { code: 600 });
        return { inputSettings: i.url ? { url: i.url } : {} };
      }
      case "RemoveInput":
        byName.delete(String(data?.inputName));
        return {};
      default:
        throw new Error(`unexpected OBS call ${type}`);
    }
  });
  return { obs: { call } as unknown as OBSWebSocket, call, names: () => [...byName.keys()].sort() };
}

describe("isWatchUrl: which pages are ours", () => {
  it.each([
    "https://wx.example/crossword/daily?token=abc",
    "http://localhost:10100/crossword/daily",
    "http://10.0.0.5:10100/crossword/word-up?token=t",
    "/crossword/daily?token=t",
    "https://wx.example/watch/atlantic?token=abc",
    "http://localhost:10100/watch/default",
    "/watch/default",
  ])("%s is one of ours", (url) => {
    expect(isWatchUrl(url)).toBe(true);
  });

  it.each([
    "https://sponsor.example/lower-third",
    "https://wx.example/admin/crosswords/desk",
    "https://wx.example/api/crossword/daily/state",
    "https://wx.example/crosswords",
    "https://wx.example/stats/crossword/daily",
    "https://wx.example/",
    "about:blank",
    "",
    undefined,
    42,
  ])("%s is not ours", (url) => {
    expect(isWatchUrl(url)).toBe(false);
  });
});

describe("the sweep with crossword sources", () => {
  const CW = "PhotonSurge globe — daily";
  const WX = "PhotonSurge globe — atlantic";

  it("removes a hand-named browser source on a /crossword/ page, as it does a /watch/ one, and leaves the operator's", async () => {
    const f = fakeObs([
      { inputName: WX, inputKind: "browser_source", url: "https://wx.example/watch/atlantic?token=a" },
      { inputName: "my crossword copy", inputKind: "browser_source", url: "https://wx.example/crossword/daily?token=c" },
      { inputName: "old globe", inputKind: "browser_source", url: "https://wx.example/watch/main?token=m" },
      { inputName: "Sponsor", inputKind: "browser_source", url: "https://sponsor.example/lower-third" },
      { inputName: "Clock", inputKind: "browser_source" },
      { inputName: "Mic", inputKind: "pulse_input_capture" },
    ]);
    const removed = await pruneForeignInputs(f.obs, WX);
    expect(removed.sort()).toEqual(["my crossword copy", "old globe"]);
    expect(f.names()).toEqual(["Clock", "Mic", WX, "Sponsor"].sort());
  });

  it("keeps a crossword channel's own source when provisioning that channel, sweeping the weather one", async () => {
    const f = fakeObs([
      { inputName: CW, inputKind: "browser_source", url: "https://wx.example/crossword/daily?token=c" },
      { inputName: `${CW} #2`, inputKind: "browser_source", url: "https://wx.example/crossword/daily?token=c" },
      { inputName: WX, inputKind: "browser_source", url: "https://wx.example/watch/atlantic?token=a" },
      { inputName: "Sponsor", inputKind: "browser_source", url: "https://sponsor.example/x" },
    ]);
    const removed = await pruneForeignInputs(f.obs, CW);
    expect(removed).toEqual([WX]);
    expect(f.names()).toEqual([CW, `${CW} #2`, "Sponsor"].sort());
  });

  it("sweeps our crossword channel's named source when another channel is provisioned", () => {
    const sweep = sweepInputs(
      [
        { inputName: CW, inputKind: "browser_source" },
        { inputName: WX, inputKind: "browser_source" },
        { inputName: "Mic", inputKind: "pulse_input_capture" },
      ],
      WX,
    );
    expect(sweep.keep).toEqual([WX]);
    expect(sweep.stale).toEqual([CW]);
    expect(sweep.foreign).toEqual(["Mic"]);
  });
});
