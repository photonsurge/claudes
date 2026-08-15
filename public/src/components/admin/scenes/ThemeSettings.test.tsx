/**
 * ThemeSettings — per-channel brand editor. Override fields patch themeOverrides;
 * the base picker patches broadcastTheme; the preview resolves via getBroadcastTheme.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import ThemeSettings from "./ThemeSettings";

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

describe("ThemeSettings", () => {
  it("patches themeOverrides when a brand field is edited", async () => {
    render(<ThemeSettings sceneId="wind" />);
    const name = await screen.findByRole("textbox", { name: "Brand name" });

    fireEvent.change(name, { target: { value: "ATLANTIC WIND" } });
    expect(patch).toHaveBeenCalledWith("wind", { themeOverrides: { name: "ATLANTIC WIND" } });
  });

  it("patches the base preset id", async () => {
    render(<ThemeSettings sceneId="wind" />);
    const base = await screen.findByRole("combobox", { name: "Base preset" });
    fireEvent.mouseDown(base);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Storm"));

    expect(patch).toHaveBeenCalledWith("wind", { broadcastTheme: "storm" });
  });

  it("shows the resolved brand in the preview (override over base)", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, themeOverrides: { name: "ZED CHANNEL" } },
      tokenError: false,
    });
    render(<ThemeSettings sceneId="wind" />);

    const preview = await screen.findByLabelText("Theme preview");
    expect(within(preview).getByText("ZED CHANNEL")).toBeInTheDocument();
  });

  it("Reset overrides clears themeOverrides when some are set", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, themeOverrides: { name: "ZED" } },
      tokenError: false,
    });
    render(<ThemeSettings sceneId="wind" />);
    const reset = await screen.findByRole("button", { name: "Reset overrides" });

    fireEvent.click(reset);
    expect(patch).toHaveBeenCalledWith("wind", { themeOverrides: {} });
  });
});
