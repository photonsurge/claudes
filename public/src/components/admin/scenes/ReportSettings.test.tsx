/**
 * ReportSettings — per-channel World Report editor. Focus presets set reportOff
 * in one click; checkboxes toggle single slides; ↑/↓ reorder. All DELTA-patched.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import ReportSettings from "./ReportSettings";

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

describe("ReportSettings", () => {
  it("the 'Weather focus' preset hides the geo slides in one click", async () => {
    render(<ReportSettings sceneId="wx" />);
    const preset = await screen.findByRole("button", { name: "Weather focus" });

    fireEvent.click(preset);
    expect(patch).toHaveBeenCalledWith("wx", { reportOff: ["seismic", "volcanoes"] });
  });

  it("the 'Quakes & volcanoes' preset hides the weather slides", async () => {
    render(<ReportSettings sceneId="geo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Quakes & volcanoes" }));
    expect(patch).toHaveBeenCalledWith("geo", { reportOff: ["hourly", "alerts"] });
  });

  it("hides a single slide via its checkbox", async () => {
    render(<ReportSettings sceneId="wx" />);
    const seismic = await screen.findByRole("checkbox", { name: "Seismic activity" });
    expect(seismic).toBeChecked();

    fireEvent.click(seismic);
    expect(patch).toHaveBeenCalledWith("wx", { reportOff: ["seismic"] });
  });

  it("reorders a slide up (delta patch carries the new order)", async () => {
    render(<ReportSettings sceneId="wx" />);
    // 'World report' (hourly) is second → moving it up puts it before 'detection'.
    fireEvent.click(await screen.findByRole("button", { name: "Move World report up" }));

    const [, sent] = patch.mock.calls[patch.mock.calls.length - 1];
    expect(sent.reportOrder.slice(0, 2)).toEqual(["hourly", "detection"]);
  });
});
