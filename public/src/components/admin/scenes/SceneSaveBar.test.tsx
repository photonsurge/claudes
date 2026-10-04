/**
 * SceneSaveBar — the sticky bar that names what a Save will change, warns when
 * the desk has moved under a staged field, and surfaces a rejected write instead
 * of pretending the change landed.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import SceneSaveBar from "./SceneSaveBar";
import { SceneDraftContext, type SceneDraftValue } from "./SceneDraft";

const save = jest.fn();
const discard = jest.fn();

function renderBar(over: Partial<SceneDraftValue> = {}) {
  const value: SceneDraftValue = {
    sceneId: "wind",
    ready: true,
    state: DEFAULT_CONTROL_STATE,
    config: DEFAULT_DIRECTOR_CONFIG,
    stage: () => {},
    stageDirector: () => {},
    format: null,
    stageFormat: () => {},
    pending: {} as Partial<ControlState>,
    pendingDirector: {} as Partial<DirectorConfig>,
    pendingFormat: {},
    dirty: false,
    conflictKeys: [],
    saving: false,
    saveError: null,
    save,
    discard,
    ...over,
  };
  return render(
    <SceneDraftContext.Provider value={value}>
      <SceneSaveBar />
    </SceneDraftContext.Provider>,
  );
}

beforeEach(() => {
  save.mockClear();
  discard.mockClear();
});

describe("SceneSaveBar", () => {
  it("stays out of the way until something is staged", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("names the cards a Save will change", () => {
    renderBar({ dirty: true, pending: { audio: DEFAULT_CONTROL_STATE.audio, readPaceCps: 9 } });

    expect(screen.getByText(/2 unsaved changes/)).toBeInTheDocument();
    expect(screen.getByText(/Music bed, Reading pace/)).toBeInTheDocument();
  });

  it("counts a director change alongside a channel one", () => {
    renderBar({
      dirty: true,
      pending: { widgetsOff: [] },
      pendingDirector: { countries: ["uk"] },
    });

    expect(screen.getByText(/2 unsaved changes/)).toBeInTheDocument();
    expect(screen.getByText(/On-air widgets, Content/)).toBeInTheDocument();
  });

  it("saves on click", () => {
    renderBar({ dirty: true, pending: { readPaceCps: 9 } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("discards a small draft straight away", () => {
    renderBar({ dirty: true, pending: { readPaceCps: 9 } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("asks first before discarding a big one", () => {
    renderBar({
      dirty: true,
      pending: {
        readPaceCps: 9,
        audio: DEFAULT_CONTROL_STATE.audio,
        widgetsOff: [],
        about: DEFAULT_CONTROL_STATE.about,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard all 4?" }));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("warns that a Save will overwrite what the desk changed underneath", () => {
    renderBar({ dirty: true, pending: { readPaceCps: 9 }, conflictKeys: ["readPaceCps"] });
    expect(screen.getByText(/will overwrite the desk/i)).toBeInTheDocument();
  });

  it("reports a failed save and says the work is still there", () => {
    renderBar({ dirty: true, pending: { readPaceCps: 9 }, saveError: "HTTP 500" });
    expect(screen.getByText(/Save failed/)).toHaveTextContent("HTTP 500");
    expect(screen.getByText(/nothing was lost/)).toBeInTheDocument();
  });

  it("blocks a second click while a save is in flight", () => {
    renderBar({ dirty: true, pending: { readPaceCps: 9 }, saving: true });
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
  });
});
