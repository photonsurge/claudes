/**
 * CameraSettings — the per-channel idle camera-motion editor: the master toggle
 * (idleMotion) plus how far it orbits/breathes and how fast (idleOrbit /
 * idleBreathe / idlePeriodS). All DELTA-patched; every change also restamps
 * spinEpoch so the drift restarts smoothly from the anchor — except while some
 * other deterministic motion (autoSpin / director drift) owns the epoch.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import CameraSettings from "./CameraSettings";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  fetchSceneState: jest.fn(),
  useScenePatcher: () => patch,
}));
import { fetchSceneState } from "../../../lib/scenes";
const mockFetch = fetchSceneState as jest.MockedFunction<typeof fetchSceneState>;

beforeEach(() => {
  patch.mockClear();
  mockFetch.mockResolvedValue({ state: { ...DEFAULT_CONTROL_STATE }, tokenError: false });
});

describe("CameraSettings", () => {
  it("enables idle motion with a fresh epoch (delta carries both)", async () => {
    render(<CameraSettings sceneId="wind" />);
    const toggle = await screen.findByRole("checkbox", { name: "Keep the camera moving" });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(patch).toHaveBeenCalledWith("wind", {
      idleMotion: true,
      spinEpoch: expect.any(Number),
    });
  });

  it("changes the orbit radius (selects are live once motion is on)", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, idleMotion: true },
      tokenError: false,
    });
    render(<CameraSettings sceneId="wind" />);
    const orbit = await screen.findByRole("combobox", { name: "Orbit" });
    fireEvent.mouseDown(orbit);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Wide · 5°"));

    expect(patch).toHaveBeenCalledWith("wind", { idleOrbit: 5, spinEpoch: expect.any(Number) });
  });

  it("changes the cycle speed", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, idleMotion: true },
      tokenError: false,
    });
    render(<CameraSettings sceneId="wind" />);
    const cycle = await screen.findByRole("combobox", { name: "Cycle speed" });
    fireEvent.mouseDown(cycle);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Slow · 90s"));

    expect(patch).toHaveBeenCalledWith("wind", { idlePeriodS: 90, spinEpoch: expect.any(Number) });
  });

  it("does NOT restamp the epoch while the world spin owns it", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, autoSpin: true },
      tokenError: false,
    });
    render(<CameraSettings sceneId="wind" />);
    const toggle = await screen.findByRole("checkbox", { name: "Keep the camera moving" });

    fireEvent.click(toggle);
    // Restamping would jump the accumulated spin longitude back to its anchor.
    expect(patch).toHaveBeenCalledWith("wind", { idleMotion: true });
  });

  it("disables the amount selects while idle motion is off", async () => {
    render(<CameraSettings sceneId="wind" />);
    await screen.findByRole("checkbox", { name: "Keep the camera moving" });
    // MUI renders the select as a div — disabled surfaces as aria-disabled.
    expect(screen.getByLabelText("Orbit")).toHaveAttribute("aria-disabled", "true");
  });
});
