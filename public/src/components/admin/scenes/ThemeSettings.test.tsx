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

async function revealAdvanced() {
  const button = await screen.findByRole("button", { name: "Advanced theme controls…" });
  fireEvent.click(button);
}

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
    await revealAdvanced();
    const name = screen.getByRole("textbox", { name: "Brand name" });

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
    await revealAdvanced();

    const title = screen.getByRole("textbox", { name: "Panel title colour" });
    fireEvent.change(title, { target: { value: "#123456" } });
    expect(patch).toHaveBeenLastCalledWith("wind", { themeOverrides: { titleColor: "#123456" } });

    fireEvent.change(screen.getByLabelText("UI highlight colour picker"), { target: { value: "#ff0000" } });
    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: { titleColor: "#123456", accent: "#ff0000" },
    });
  });

  it("advanced fields hide behind the Advanced toggle", async () => {
    render(<ThemeSettings sceneId="wind" />);
    await screen.findByRole("combobox", { name: "Base preset" });

    // Every manual field is collapsed by default; the toggle reveals both the
    // grouped colour controls and the raw-CSS expert fields.
    expect(screen.queryByRole("textbox", { name: "Brand name" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Ticker background (CSS)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced theme controls…" }));
    expect(screen.getByRole("textbox", { name: "Brand name" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Ticker background (CSS)" })).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Ticker background (CSS)" }), {
      target: { value: "linear-gradient(#000, #111)" },
    });
    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: { tickerBg: "linear-gradient(#000, #111)" },
    });
  });

  it("persists panel and locator palette overrides from the clearly labelled groups", async () => {
    render(<ThemeSettings sceneId="wind" />);
    await revealAdvanced();

    fireEvent.change(screen.getByRole("textbox", { name: "G.O.D.S. panel top" }), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Locator land colour" }), {
      target: { value: "#445566" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Inset tile colour" }), {
      target: { value: "#223344" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Map highlight colour" }), {
      target: { value: "#abcdef" },
    });

    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: {
        godsPanelTopColor: "#112233",
        minimapLandColor: "#445566",
        tileColor: "#223344",
        mapHighlightColor: "#abcdef",
      },
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

  it("resets the preset, overrides, and main-map palette to the default theme", async () => {
    mockFetch.mockResolvedValue({
      state: {
        ...DEFAULT_CONTROL_STATE,
        broadcastTheme: "storm",
        themeOverrides: { accent: "#ff00ff" },
        basemapColors: { ocean: "#111111", land: "#222222", border: "#333333" },
      },
      tokenError: false,
    });
    render(<ThemeSettings sceneId="wind" />);
    const reset = await screen.findByRole("button", { name: "Reset to default theme" });

    fireEvent.click(reset);
    expect(patch).toHaveBeenCalledWith("wind", {
      broadcastTheme: "command",
      themeOverrides: {},
      basemapColors: { ocean: "#080e18", land: "#1c222e", border: "#dce4f0" },
    });
  });

  it("stages main-map vector colours from the scene theme form", async () => {
    render(<ThemeSettings sceneId="wind" />);
    await revealAdvanced();

    fireEvent.change(screen.getByLabelText("Ocean"), { target: { value: "#123456" } });
    expect(patch).toHaveBeenLastCalledWith("wind", {
      basemapColors: {
        ...DEFAULT_CONTROL_STATE.basemapColors,
        ocean: "#123456",
      },
    });
  });

  it("opens the two-colour generator in a preview dialog and applies its coordinated palette", async () => {
    render(<ThemeSettings sceneId="wind" />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate palette…" }));

    const dialog = screen.getByRole("dialog", { name: "Generate scene palette" });
    expect(within(dialog).getByLabelText("Theme preview")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Palette highlight" }), {
      target: { value: "#ff6600" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Palette dark base" }), {
      target: { value: "#101820" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply generated palette" }));

    expect(patch).toHaveBeenLastCalledWith("wind", {
      themeOverrides: expect.objectContaining({
        accent: "#ff6600",
        mapHighlightColor: "#ff6600",
        minimapAccentColor: "#ff6600",
        tileColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      }),
      basemapColors: expect.objectContaining({
        ocean: expect.stringMatching(/^#[0-9a-f]{6}$/),
        land: expect.stringMatching(/^#[0-9a-f]{6}$/),
        border: expect.stringMatching(/^#[0-9a-f]{6}$/),
      }),
    });
  });

  it("lets the generator leave map, locator, and existing text colours alone", async () => {
    mockFetch.mockResolvedValue({
      state: { ...DEFAULT_CONTROL_STATE, themeOverrides: { textColor: "#abcdef" } },
      tokenError: false,
    });
    render(<ThemeSettings sceneId="wind" />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate palette…" }));
    const dialog = screen.getByRole("dialog", { name: "Generate scene palette" });

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Generate text colours" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include main map" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include locator globe" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply generated palette" }));

    const applied = patch.mock.calls.at(-1)?.[1];
    expect(applied).not.toHaveProperty("basemapColors");
    expect(applied?.themeOverrides).toMatchObject({ textColor: "#abcdef" });
    expect(applied?.themeOverrides).not.toHaveProperty("mapHighlightColor");
    expect(applied?.themeOverrides).not.toHaveProperty("minimapAccentColor");
  });
});
