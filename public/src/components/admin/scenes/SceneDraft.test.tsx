/**
 * SceneDraft — the settings page's data owner. It reads the channel's two
 * documents ONCE, hands cards a merged (server + staged) view, follows the live
 * desk, and applies the accumulated draft on Save as one patch per bucket.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import SceneDraftProvider, { useSceneDraft } from "./SceneDraft";

const fetchState = jest.fn();
const emitPatch = jest.fn();
const patchSceneMock = jest.fn(
  async (_id: string, _patch: Partial<ControlState>) =>
    ({ ok: true }) as { ok: boolean; error?: string },
);
jest.mock("../../../lib/scenes", () => ({
  fetchSceneState: (...a: unknown[]) => fetchState(...a),
  patchScene: (id: string, patch: Partial<ControlState>) => patchSceneMock(id, patch),
  emitScenePatch: (...a: unknown[]) => emitPatch(...a),
}));

const fetchConfig = jest.fn();
const patchDirector = jest.fn(async () => ({}));
jest.mock("../../../lib/director", () => ({
  fetchDirectorConfig: (...a: unknown[]) => fetchConfig(...a),
  patchDirectorConfig: (...a: unknown[]) => patchDirector(...(a as [])),
  mergeConfig: (prev: object, patch: object) => ({ ...prev, ...patch }),
}));

const getFormat = jest.fn();
const saveFormat = jest.fn();
jest.mock("../../../lib/short-formats", () => ({
  getShortFormat: (...a: unknown[]) => getFormat(...a),
  saveShortFormat: (...a: unknown[]) => saveFormat(...a),
}));

/** A socket whose SCENE_STATE handler the test can fire by hand. */
const handlers = new Map<string, (p: unknown) => void>();
const socket = {
  on: (e: string, fn: (p: unknown) => void) => handlers.set(e, fn),
  off: (e: string) => handlers.delete(e),
};
jest.mock("../../../lib/socket-provider", () => ({
  useSocket: () => ({ socket, connected: true }),
}));

/** Stand-in card: renders straight from the draft and stages into both buckets. */
function Card() {
  const { ready, state, config, stage, stageDirector, save, discard, dirty, saveError } =
    useSceneDraft();
  if (!ready) return <span>loading</span>;
  return (
    <div>
      <span data-testid="pace">{state.readPaceCps}</span>
      <span data-testid="hold">{state.slideHoldMs}</span>
      <span data-testid="countries">{config.countries.join(",")}</span>
      <span data-testid="dirty">{String(dirty)}</span>
      {saveError && <span data-testid="error">{saveError}</span>}
      <button onClick={() => stage({ readPaceCps: 9 })}>set pace</button>
      <button onClick={() => stage({ slideHoldMs: 8000, spinEpoch: 123 })}>set dwell</button>
      <button onClick={() => stageDirector({ countries: ["uk"] })}>set countries</button>
      <button onClick={save}>Save</button>
      <button onClick={discard}>Discard</button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <SceneDraftProvider sceneId="wind">
      <Card />
    </SceneDraftProvider>,
  );

beforeEach(() => {
  handlers.clear();
  [fetchState, emitPatch, patchSceneMock, fetchConfig, patchDirector].forEach((m) => m.mockClear());
  fetchState.mockResolvedValue({ state: { ...DEFAULT_CONTROL_STATE }, tokenError: false });
  fetchConfig.mockResolvedValue({ ...DEFAULT_DIRECTOR_CONFIG });
  patchSceneMock.mockResolvedValue({ ok: true });
});

describe("SceneDraftProvider", () => {
  it("reads each document exactly once for the whole page", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  it("renders staged values over the server ones without patching anything", async () => {
    renderProvider();
    await screen.findByTestId("pace");
    expect(screen.getByTestId("pace")).toHaveTextContent(String(DEFAULT_CONTROL_STATE.readPaceCps));

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));

    expect(screen.getByTestId("pace")).toHaveTextContent("9");
    expect(emitPatch).not.toHaveBeenCalled();
    expect(patchSceneMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("Save applies one patch per bucket and restamps spinEpoch at apply time", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    fireEvent.click(screen.getByRole("button", { name: "set dwell" }));
    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("dirty")).toHaveTextContent("false"));

    expect(patchSceneMock).toHaveBeenCalledTimes(1);
    const sent = patchSceneMock.mock.calls[0][1];
    expect(sent.readPaceCps).toBe(9);
    expect(sent.slideHoldMs).toBe(8000);
    // spinEpoch is restamped at apply time, not the staged click-time value.
    expect(sent.spinEpoch).not.toBe(123);
    // The socket carried the same delta so /watch cuts over immediately — and
    // exactly once, rather than also through the debounced live patcher.
    expect(emitPatch).toHaveBeenCalledTimes(1);
    expect(emitPatch.mock.calls[0][1]).toBe("wind");
    expect(emitPatch.mock.calls[0][2]).toEqual(sent);
    expect(patchDirector).toHaveBeenCalledWith("wind", { countries: ["uk"] });
  });

  it("sends only the buckets that were staged", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchDirector).toHaveBeenCalledTimes(1));
    expect(patchSceneMock).not.toHaveBeenCalled();
  });

  it("keeps the draft and reports the reason when a save is rejected", async () => {
    patchSceneMock.mockResolvedValue({ ok: false, error: "HTTP 500" });
    renderProvider();
    await screen.findByTestId("pace");

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByTestId("error")).toHaveTextContent("HTTP 500");
    // Still dirty — the operator's edit is the only copy of it.
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    expect(screen.getByTestId("pace")).toHaveTextContent("9");
  });

  it("Discard drops the draft without refetching anything", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByTestId("pace")).toHaveTextContent(String(DEFAULT_CONTROL_STATE.readPaceCps));
    expect(screen.getByTestId("countries")).toHaveTextContent(
      DEFAULT_DIRECTOR_CONFIG.countries.join(","),
    );
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    // The base document was never re-read — the merged view simply fell back.
    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  it("follows a live change from the operator's desk", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    act(() => {
      handlers.get("scene:state")?.({ id: "wind", state: { readPaceCps: 14 } });
    });

    expect(screen.getByTestId("pace")).toHaveTextContent("14");
  });

  it("ignores a live change for a different channel", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    act(() => {
      handlers.get("scene:state")?.({ id: "other", state: { readPaceCps: 14 } });
    });

    expect(screen.getByTestId("pace")).toHaveTextContent(String(DEFAULT_CONTROL_STATE.readPaceCps));
  });

  it("a staged field wins over a live change to the same field", async () => {
    renderProvider();
    await screen.findByTestId("pace");

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    act(() => {
      handlers.get("scene:state")?.({ id: "wind", state: { readPaceCps: 14, slideHoldMs: 5000 } });
    });

    // The edit in progress stands…
    expect(screen.getByTestId("pace")).toHaveTextContent("9");
    // …while an untouched field adopts the desk's value.
    expect(screen.getByTestId("hold")).toHaveTextContent("5000");
  });
});

/** A format editor's card: the same draft, plus the third document. */
function FormatCard() {
  const { ready, format, stage, stageDirector, stageFormat, save, dirty, saveError, loadError } = useSceneDraft();
  if (loadError) return <span data-testid="load-error">{loadError}</span>;
  if (!ready || !format) return <span>loading</span>;
  return (
    <div>
      <span data-testid="name">{format.name}</span>
      <span data-testid="budget">{format.template.budgetMs}</span>
      <span data-testid="dirty">{String(dirty)}</span>
      {saveError && <span data-testid="error">{saveError}</span>}
      <button onClick={() => stage({ readPaceCps: 9 })}>set pace</button>
      <button onClick={() => stageDirector({ minQuakeMag: 6 })}>set quake</button>
      <button onClick={() => stageFormat({ name: "Europe", template: { ...format.template, budgetMs: 90_000 } })}>
        set template
      </button>
      <button onClick={() => stageFormat({ template: { ...format.template, scope: { type: "places", places: [] } } })}>
        empty places
      </button>
      <button onClick={save}>Save</button>
    </div>
  );
}

describe("SceneDraftProvider with a short format (the third document)", () => {
  const renderFormat = () =>
    render(
      <SceneDraftProvider sceneId="short-eu" formatId="short-eu">
        <FormatCard />
      </SceneDraftProvider>,
    );

  beforeEach(() => {
    getFormat.mockReset();
    saveFormat.mockReset();
    getFormat.mockResolvedValue({ ok: true, data: defaultShortFormat("short-eu", "Round-up") });
    saveFormat.mockImplementation(async (id: string, patch: object) => ({ ...defaultShortFormat(id, "Round-up"), ...patch }));
  });

  it("loads the short settings with the look and director config, once each", async () => {
    renderFormat();
    expect(await screen.findByTestId("name")).toHaveTextContent("Round-up");
    expect(getFormat).toHaveBeenCalledTimes(1);
    expect(getFormat).toHaveBeenCalledWith("short-eu");
    expect(fetchState).toHaveBeenCalledWith("short-eu");
    expect(fetchConfig).toHaveBeenCalledWith("short-eu");
  });

  it("one Save writes all three documents, once each", async () => {
    renderFormat();
    await screen.findByTestId("name");

    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    fireEvent.click(screen.getByRole("button", { name: "set quake" }));
    fireEvent.click(screen.getByRole("button", { name: "set template" }));
    expect(screen.getByTestId("budget")).toHaveTextContent("90000");
    expect(saveFormat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("dirty")).toHaveTextContent("false"));

    expect(patchSceneMock).toHaveBeenCalledTimes(1);
    expect(patchSceneMock.mock.calls[0][1]).toEqual({ readPaceCps: 9 });
    expect(patchDirector).toHaveBeenCalledWith("short-eu", { minQuakeMag: 6 });
    expect(saveFormat).toHaveBeenCalledTimes(1);
    expect(saveFormat.mock.calls[0][0]).toBe("short-eu");
    expect(saveFormat.mock.calls[0][1]).toMatchObject({ name: "Europe", template: { budgetMs: 90_000 } });
    // The saved copy is the new base.
    expect(screen.getByTestId("name")).toHaveTextContent("Europe");
  });

  it("sends only the short settings when only they were staged", async () => {
    renderFormat();
    await screen.findByTestId("name");
    fireEvent.click(screen.getByRole("button", { name: "set template" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveFormat).toHaveBeenCalledTimes(1));
    expect(patchSceneMock).not.toHaveBeenCalled();
    expect(patchDirector).not.toHaveBeenCalled();
  });

  it("blocks the whole Save while Several places has no place, writing nothing", async () => {
    renderFormat();
    await screen.findByTestId("name");
    fireEvent.click(screen.getByRole("button", { name: "set pace" }));
    fireEvent.click(screen.getByRole("button", { name: "empty places" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("error")).toHaveTextContent("add at least one place");
    expect(patchSceneMock).not.toHaveBeenCalled();
    expect(saveFormat).not.toHaveBeenCalled();
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("keeps the draft when the short settings fail to save", async () => {
    saveFormat.mockRejectedValue(new Error("no such format"));
    renderFormat();
    await screen.findByTestId("name");
    fireEvent.click(screen.getByRole("button", { name: "set template" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("error")).toHaveTextContent("no such format");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    expect(screen.getByTestId("name")).toHaveTextContent("Europe");
  });

  it("says when the short settings can't be read", async () => {
    getFormat.mockResolvedValue({ ok: false, error: "no such format" });
    renderFormat();
    expect(await screen.findByTestId("load-error")).toHaveTextContent("no such format");
  });

  it("a channel page never reads a format", async () => {
    renderProvider();
    await screen.findByTestId("pace");
    expect(getFormat).not.toHaveBeenCalled();
  });
});
