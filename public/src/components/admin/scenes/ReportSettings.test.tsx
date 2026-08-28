/**
 * ReportSettings — per-channel World Report editor. Focus presets set reportOff
 * in one click; checkboxes toggle single slides; ↑/↓ reorder; a dwell picker
 * sets reportHoldMs. All DELTA-patched.
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
  it("the 'Weather focus' preset curates BOTH slides and feed content in one click", async () => {
    render(<ReportSettings sceneId="wx" />);
    const preset = await screen.findByRole("button", { name: "Weather focus" });

    fireEvent.click(preset);
    expect(patch).toHaveBeenCalledWith("wx", {
      reportOff: ["seismic", "volcanoes"],
      reportKindsOff: ["quake", "volcano"],
    });
  });

  it("the 'Quakes & volcanoes' preset drops the weather slides + alert kind", async () => {
    render(<ReportSettings sceneId="geo" />);
    fireEvent.click(await screen.findByRole("button", { name: "Quakes & volcanoes" }));
    expect(patch).toHaveBeenCalledWith("geo", { reportOff: ["hourly", "alerts"], reportKindsOff: ["alert"] });
  });

  it("hides a whole event KIND from the feed + grid via its checkbox", async () => {
    render(<ReportSettings sceneId="wx" />);
    const quakes = await screen.findByRole("checkbox", { name: "Earthquakes" });
    expect(quakes).toBeChecked();

    fireEvent.click(quakes);
    expect(patch).toHaveBeenCalledWith("wx", { reportKindsOff: ["quake"] });
  });

  it("hides a single slide via its checkbox", async () => {
    render(<ReportSettings sceneId="wx" />);
    const seismic = await screen.findByRole("checkbox", { name: "Seismic activity" });
    expect(seismic).toBeChecked();

    fireEvent.click(seismic);
    expect(patch).toHaveBeenCalledWith("wx", { reportOff: ["seismic"] });
  });

  it("shows the alert-hazard filter only while the alert kind is on", async () => {
    render(<ReportSettings sceneId="wx" />);
    expect(await screen.findByText("Alert hazards")).toBeInTheDocument();
  });

  it("hides the alert-hazard filter when the alert kind is off", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, reportKindsOff: ["alert"] },
      tokenError: false,
    });
    render(<ReportSettings sceneId="geo" />);
    // The kind checkboxes render, so the component is mounted…
    expect(await screen.findByRole("checkbox", { name: "Earthquakes" })).toBeInTheDocument();
    // …but with alerts off, the hazard sub-filter is gone.
    expect(screen.queryByText("Alert hazards")).not.toBeInTheDocument();
  });

  it("changes the report rotation dwell via the slider", async () => {
    render(<ReportSettings sceneId="wx" />);
    const dwell = await screen.findByRole("slider", { name: "Report rotation dwell" });
    fireEvent.change(dwell, { target: { value: "12000" } });

    expect(patch).toHaveBeenCalledWith("wx", { reportHoldMs: 12000 });
  });

  it("types an exact report dwell override in seconds", async () => {
    render(<ReportSettings sceneId="wx" />);
    const secs = await screen.findByRole("textbox", { name: "Report rotation dwell seconds" });
    fireEvent.change(secs, { target: { value: "9" } });
    fireEvent.blur(secs);

    expect(patch).toHaveBeenCalledWith("wx", { reportHoldMs: 9000 });
  });

  it("reorders a slide up (delta patch carries the new order)", async () => {
    render(<ReportSettings sceneId="wx" />);
    // 'World report' (hourly) is second → moving it up puts it before 'detection'.
    fireEvent.click(await screen.findByRole("button", { name: "Move World report up" }));

    const [, sent] = patch.mock.calls[patch.mock.calls.length - 1];
    expect(sent.reportOrder.slice(0, 2)).toEqual(["hourly", "detection"]);
  });
});
