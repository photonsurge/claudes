/**
 * TickerSettings — per-channel bottom-crawl content editor. Checkboxes toggle
 * crawl kinds (tickerKindsOff, an off-list); the alert-hazard chips only show
 * while the alert kind is on. All DELTA-patched via the page's SceneDraft.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { TICKER_KINDS } from "@photonsurge/shared/broadcast-ticker";
import TickerSettings from "./TickerSettings";

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

describe("TickerSettings", () => {
  it("renders every catalog kind, all on by default", async () => {
    render(<TickerSettings sceneId="wx" />);
    for (const k of TICKER_KINDS) {
      expect(await screen.findByRole("checkbox", { name: k.label })).toBeChecked();
    }
  });

  it("hides a crawl kind via its checkbox (delta patch carries the off-list)", async () => {
    render(<TickerSettings sceneId="wx" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Earthquakes" }));
    expect(patch).toHaveBeenCalledWith("wx", { tickerKindsOff: ["quake"] });
  });

  it("re-showing a kind drops it from the staged off-list", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, tickerKindsOff: ["ad", "track"] },
      tokenError: false,
    });
    render(<TickerSettings sceneId="wx" />);
    const ads = await screen.findByRole("checkbox", { name: "Sponsor mentions" });
    expect(ads).not.toBeChecked();

    fireEvent.click(ads);
    expect(patch).toHaveBeenCalledWith("wx", { tickerKindsOff: ["track"] });
  });

  it("stages the crawl-specific alert-hazard filter via the chips", async () => {
    render(<TickerSettings sceneId="wx" />);
    expect(await screen.findByText("Alert hazards")).toBeInTheDocument();
  });

  it("hides the alert-hazard filter when the alert kind is off", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, tickerKindsOff: ["alert"] },
      tokenError: false,
    });
    render(<TickerSettings sceneId="geo" />);
    expect(await screen.findByRole("checkbox", { name: "Earthquakes" })).toBeInTheDocument();
    expect(screen.queryByText("Alert hazards")).not.toBeInTheDocument();
  });
});
