/**
 * SlidesSettings — the per-channel bottom-left deck editor: visibility (slidesOff),
 * order (slideOrder via ↑/↓), and dwell (slideHoldMs). All DELTA-patched; the
 * pinned on-air lede is locked.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import SlidesSettings from "./SlidesSettings";

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

describe("SlidesSettings", () => {
  it("hides a slide by unchecking it (delta patch carries slidesOff)", async () => {
    render(<SlidesSettings sceneId="wind" />);
    const forecast = await screen.findByRole("checkbox", { name: "Forecast" });
    expect(forecast).toBeChecked();

    fireEvent.click(forecast);
    expect(patch).toHaveBeenCalledWith("wind", { slidesOff: ["forecast"] });
  });

  it("locks the pinned on-air lede (checked + disabled, no toggle patch)", async () => {
    render(<SlidesSettings sceneId="wind" />);
    const onair = await screen.findByRole("checkbox", { name: "On-air lede" });
    expect(onair).toBeChecked();
    expect(onair).toBeDisabled();
  });

  it("reorders a slide down (delta patch carries the full new order)", async () => {
    render(<SlidesSettings sceneId="wind" />);
    // 'Track info' is the first non-pinned slide → moving it down swaps it with
    // the next catalog slide ('Area history').
    const moveDown = await screen.findByRole("button", { name: "Move Track info down" });
    fireEvent.click(moveDown);

    expect(patch).toHaveBeenCalledTimes(1);
    const [, sent] = patch.mock.calls[0];
    expect(sent.slideOrder.slice(0, 2)).toEqual(["history", "track"]);
  });

  it("changes the rotation dwell via the slider", async () => {
    render(<SlidesSettings sceneId="wind" />);
    const dwell = await screen.findByRole("slider", { name: "Rotation dwell" });
    fireEvent.change(dwell, { target: { value: "24000" } });

    expect(patch).toHaveBeenCalledWith("wind", { slideHoldMs: 24000 });
  });

  it("types an exact dwell override in seconds", async () => {
    render(<SlidesSettings sceneId="wind" />);
    const secs = await screen.findByRole("textbox", { name: "Rotation dwell seconds" });
    fireEvent.change(secs, { target: { value: "45" } });
    fireEvent.blur(secs);

    expect(patch).toHaveBeenCalledWith("wind", { slideHoldMs: 45000 });
  });

  it("hides a point-history variable via its checkbox", async () => {
    render(<SlidesSettings sceneId="wind" />);
    const cape = await screen.findByRole("checkbox", { name: "CAPE (storm energy)" });
    expect(cape).toBeChecked();

    fireEvent.click(cape);
    expect(patch).toHaveBeenCalledWith("wind", { pointVarsOff: ["storm"] });
  });
});
