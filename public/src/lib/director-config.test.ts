/**
 * Draft-buffer behaviour of useDirectorConfig — the click-to-save form model:
 * form fields stage a local draft (no network), one Save PATCHes it, and the
 * always-instant Auto/Skip path (applyNow) bypasses the draft. Plus the pure
 * mergeConfig helper that keeps partial map patches from wiping their siblings.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { mergeConfig, useDirectorConfig } from "./director";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";

describe("mergeConfig", () => {
  it("deep-merges partial kinds / hold maps without wiping siblings", () => {
    // Genuinely partial sub-objects (real editors spread the full record; this
    // proves the merge fills in the untouched siblings from the base).
    const merged = mergeConfig(DEFAULT_DIRECTOR_CONFIG, {
      kinds: { region: true },
      quakeHoldSeconds: { great: 40 },
    } as unknown as Partial<DirectorConfig>);
    expect(merged.kinds.region).toBe(true);
    expect(merged.kinds.global).toBe(DEFAULT_DIRECTOR_CONFIG.kinds.global);
    expect(merged.quakeHoldSeconds.great).toBe(40);
    expect(merged.quakeHoldSeconds.micro).toBe(DEFAULT_DIRECTOR_CONFIG.quakeHoldSeconds.micro);
  });

  it("replaces top-level scalars", () => {
    expect(mergeConfig(DEFAULT_DIRECTOR_CONFIG, { transitionSeconds: 9 }).transitionSeconds).toBe(9);
  });
});

describe("useDirectorConfig draft buffer", () => {
  const loaded = { ...DEFAULT_DIRECTOR_CONFIG, transitionSeconds: 3 };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn((_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      // PATCH echoes the loaded config with the sent patch applied over it; GET
      // returns the loaded config.
      const patch = method === "PATCH" ? JSON.parse(opts!.body as string) : {};
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...loaded, ...patch }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const patchCalls = () => fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH");

  it("edit stages a draft without PATCHing", async () => {
    const { result } = renderHook(() => useDirectorConfig("default"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1); // just the initial GET
    act(() => result.current.edit({ transitionSeconds: 7 }));
    expect(patchCalls()).toHaveLength(0); // no network on edit
    expect(result.current.dirty).toBe(true);
    expect(result.current.draft.transitionSeconds).toBe(7);
    expect(result.current.config.transitionSeconds).toBe(3); // saved untouched
  });

  it("save PATCHes the draft once and clears dirty", async () => {
    const { result } = renderHook(() => useDirectorConfig("default"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.edit({ transitionSeconds: 7 }));
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(patchCalls()).toHaveLength(1);
    expect(result.current.config.transitionSeconds).toBe(7);
    expect(result.current.draft.transitionSeconds).toBe(7);
  });

  it("discard reverts the draft to saved", async () => {
    const { result } = renderHook(() => useDirectorConfig("default"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.edit({ transitionSeconds: 7 }));
    act(() => result.current.discard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft.transitionSeconds).toBe(3);
    expect(patchCalls()).toHaveLength(0);
  });

  it("applyNow PATCHes immediately without dirtying the form", async () => {
    const { result } = renderHook(() => useDirectorConfig("default"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      result.current.applyNow({ mode: "auto" });
    });
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(result.current.dirty).toBe(false);
    expect(result.current.config.mode).toBe("auto");
    expect(result.current.draft.mode).toBe("auto");
  });
});
