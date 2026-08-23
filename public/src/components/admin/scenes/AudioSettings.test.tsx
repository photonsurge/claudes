/**
 * AudioSettings — the per-channel music-bed editor: the master toggle plus
 * mode / mute / volume, all shipped as ONE full audio object per delta so the
 * draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import AudioSettings from "./AudioSettings";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  fetchSceneState: jest.fn(),
  useScenePatcher: () => patch,
}));
import { fetchSceneState } from "../../../lib/scenes";
const mockFetch = fetchSceneState as jest.MockedFunction<typeof fetchSceneState>;

const withAudio = (over: Partial<typeof DEFAULT_CONTROL_STATE.audio>) => ({
  ...DEFAULT_CONTROL_STATE,
  audio: { ...DEFAULT_CONTROL_STATE.audio, ...over },
});

beforeEach(() => {
  patch.mockClear();
  mockFetch.mockResolvedValue({ state: { ...DEFAULT_CONTROL_STATE }, tokenError: false });
});

describe("AudioSettings", () => {
  it("turns the bed on with the FULL audio object in the delta", async () => {
    render(<AudioSettings sceneId="wind" />);
    const toggle = await screen.findByRole("checkbox", { name: "Music" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(patch).toHaveBeenCalledWith("wind", {
      audio: { ...DEFAULT_CONTROL_STATE.audio, enabled: true },
    });
  });

  it("pins the arrangement mode", async () => {
    mockFetch.mockResolvedValue({ state: withAudio({ enabled: true }), tokenError: false });
    render(<AudioSettings sceneId="wind" />);
    const mode = await screen.findByRole("combobox", { name: "Mode" });
    fireEvent.mouseDown(mode);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Deep House"));

    expect(patch).toHaveBeenCalledWith("wind", {
      audio: { ...DEFAULT_CONTROL_STATE.audio, enabled: true, mode: "deep" },
    });
  });

  it("mutes without losing the volume level", async () => {
    mockFetch.mockResolvedValue({
      state: withAudio({ enabled: true, volume: 0.4 }),
      tokenError: false,
    });
    render(<AudioSettings sceneId="wind" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mute" }));

    expect(patch).toHaveBeenCalledWith("wind", {
      audio: { ...DEFAULT_CONTROL_STATE.audio, enabled: true, volume: 0.4, muted: true },
    });
  });

  it("changes the volume", async () => {
    mockFetch.mockResolvedValue({ state: withAudio({ enabled: true }), tokenError: false });
    render(<AudioSettings sceneId="wind" />);
    const slider = await screen.findByRole("slider", { name: "Audio volume" });
    fireEvent.change(slider, { target: { value: 0.25 } });

    expect(patch).toHaveBeenCalledWith("wind", {
      audio: { ...DEFAULT_CONTROL_STATE.audio, enabled: true, volume: 0.25 },
    });
  });

  it("disables mode/mute/volume while the bed is off", async () => {
    render(<AudioSettings sceneId="wind" />);
    await screen.findByRole("checkbox", { name: "Music" });
    // MUI renders the select as a div — disabled surfaces as aria-disabled.
    expect(screen.getByLabelText("Audio mode")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "Mute" })).toBeDisabled();
  });
});
