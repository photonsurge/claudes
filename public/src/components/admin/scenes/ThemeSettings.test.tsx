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

jest.mock("../../broadcast/SubGlobeWidget", () => ({
  __esModule: true,
  default: () => <canvas data-testid="theme-minimap" />,
}));

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

  it("each colour field patches ITS OWN override key (regression: swatch was hardcoded to accent)", async () => {
    render(<ThemeSettings sceneId="wind" />);

    const title = await screen.findByRole("textbox", { name: "Panel title colour" });
    fireEvent.change(title, { target: { value: "#123456" } });
    expect(patch).toHaveBeenLastCalledWith("wind", { themeOverrides: { titleColor: "#123456" } });

    fireEvent.change(screen.getByLabelText("Accent colour picker"), { target: { value: "#ff0000" } });
    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: { titleColor: "#123456", accent: "#ff0000" },
    });
  });

  it("advanced fields hide behind the Advanced toggle", async () => {
    render(<ThemeSettings sceneId="wind" />);
    await screen.findByRole("textbox", { name: "Brand name" });

    // Collapsed by default (hidden from the a11y tree); the toggle reveals the
    // raw-CSS fields.
    expect(screen.queryByRole("textbox", { name: "Ticker background (CSS)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced…" }));
    expect(screen.getByRole("textbox", { name: "Ticker background (CSS)" })).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Ticker background (CSS)" }), {
      target: { value: "linear-gradient(#000, #111)" },
    });
    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: { tickerBg: "linear-gradient(#000, #111)" },
    });
  });

  it("persists G.O.D.S. and minimap palette overrides from the advanced form", async () => {
    render(<ThemeSettings sceneId="wind" />);
    await screen.findByRole("textbox", { name: "Brand name" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced…" }));

    fireEvent.change(screen.getByRole("textbox", { name: "G.O.D.S. panel top" }), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Minimap land colour" }), {
      target: { value: "#445566" },
    });

    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: { godsPanelTopColor: "#112233", minimapLandColor: "#445566" },
    });
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
