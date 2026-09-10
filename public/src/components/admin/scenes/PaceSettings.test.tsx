/**
 * PaceSettings — the per-channel reading-pace control (readPaceCps). One slider,
 * DELTA-patched, with the pace shown back in both units.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_READ_CPS, READ_CPS_MAX } from "@photonsurge/shared/reading-pace";
import PaceSettings from "./PaceSettings";

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

describe("PaceSettings", () => {
  it("shows the channel's pace in characters/sec and words/min", async () => {
    render(<PaceSettings sceneId="wind" />);
    const slider = await screen.findByRole("slider", { name: "Reading pace" });
    expect(slider).toHaveValue(String(DEFAULT_READ_CPS));
    expect(screen.getByText(/characters\/sec/)).toHaveTextContent(`${DEFAULT_READ_CPS} characters/sec · 150 words/min`);
  });

  it("delta-patches a new pace", async () => {
    render(<PaceSettings sceneId="wind" />);
    const slider = await screen.findByRole("slider", { name: "Reading pace" });
    fireEvent.change(slider, { target: { value: "9" } });

    expect(patch).toHaveBeenCalledWith("wind", { readPaceCps: 9 });
  });

  it("reads a pace back from the channel state, clamped", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, readPaceCps: 900 },
      tokenError: false,
    });
    render(<PaceSettings sceneId="wind" />);
    const slider = await screen.findByRole("slider", { name: "Reading pace" });
    expect(slider).toHaveValue(String(READ_CPS_MAX));
  });
});
