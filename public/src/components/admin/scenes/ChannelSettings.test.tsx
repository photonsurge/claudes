/**
 * ChannelSettings — a checkbox per broadcast widget, checked = visible. Toggling
 * one emits a DELTA patch (widgetsOff) via the injected scene patcher, and a
 * widget already in the off-list renders unchecked.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import ChannelSettings from "./ChannelSettings";

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

describe("ChannelSettings", () => {
  it("hides a widget by removing its check (delta patch carries the off-list)", async () => {
    render(<ChannelSettings sceneId="wind" />);

    const worldReport = await screen.findByRole("checkbox", { name: "World Report" });
    expect(worldReport).toBeChecked();

    fireEvent.click(worldReport);

    expect(patch).toHaveBeenCalledWith("wind", { widgetsOff: ["worldReport"] });
  });

  it("renders an already-hidden widget unchecked", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, widgetsOff: ["seismic"] },
      tokenError: false,
    });
    render(<ChannelSettings sceneId="wind" />);

    const seismic = await screen.findByRole("checkbox", { name: "Seismic monitor" });
    expect(seismic).not.toBeChecked();

    // Re-checking it clears the off-list (shows everything again).
    fireEvent.click(seismic);
    expect(patch).toHaveBeenCalledWith("wind", { widgetsOff: [] });
  });

  it("Hide all pushes every widget id into the off-list", async () => {
    render(<ChannelSettings sceneId="default" />);
    const hideAll = await screen.findByRole("button", { name: "Hide all" });

    fireEvent.click(hideAll);

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [, sentPatch] = patch.mock.calls[patch.mock.calls.length - 1];
    expect(sentPatch.widgetsOff).toEqual(expect.arrayContaining(["worldReport", "seismic", "buildInfo"]));
  });
});
