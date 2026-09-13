/**
 * ThemeSettings — per-channel brand editor. Override fields stage themeOverrides;
 * the base picker stages broadcastTheme; the preview resolves via getBroadcastTheme.
 * The advanced field grid lives in ThemeFieldGroups and the generator in
 * ThemePaletteDialog; they are exercised through this card.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import ThemeSettings from "./ThemeSettings";
import { renderInDraft } from "./draft-harness";

jest.mock("../../broadcast/SubGlobeWidget", () => ({
  __esModule: true,
  default: () => <canvas data-testid="theme-minimap" />,
}));

const revealAdvanced = () =>
  fireEvent.click(screen.getByRole("button", { name: "Advanced theme controls…" }));

describe("ThemeSettings", () => {
  it("stages themeOverrides when a brand field is edited", () => {
    const d = renderInDraft(<ThemeSettings />);
    revealAdvanced();

    fireEvent.change(screen.getByRole("textbox", { name: "Brand name" }), {
      target: { value: "ATLANTIC WIND" },
    });
    expect(d.last()).toEqual({ themeOverrides: { name: "ATLANTIC WIND" } });
  });

  it("stages the base preset id", () => {
    const d = renderInDraft(<ThemeSettings />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Base preset" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Storm"));

    expect(d.last()).toEqual({ broadcastTheme: "storm" });
  });

  it("shows the resolved brand in the preview (override over base)", () => {
    renderInDraft(<ThemeSettings />, { state: { themeOverrides: { name: "ZED CHANNEL" } } });

    const preview = screen.getByLabelText("Theme preview");
    expect(within(preview).getByText("ZED CHANNEL")).toBeInTheDocument();
  });

  it("each colour field stages ITS OWN override key (regression: swatch was hardcoded to accent)", () => {
    const d = renderInDraft(<ThemeSettings />);
    revealAdvanced();

    fireEvent.change(screen.getByRole("textbox", { name: "Panel title colour" }), {
      target: { value: "#123456" },
    });
    expect(d.last()).toEqual({ themeOverrides: { titleColor: "#123456" } });

    fireEvent.change(screen.getByLabelText("UI highlight colour picker"), {
      target: { value: "#ff0000" },
    });
    // The second delta is built from the merged draft, so the first key survives.
    expect(d.last()).toEqual({ themeOverrides: { titleColor: "#123456", accent: "#ff0000" } });
  });

  it("advanced fields hide behind the Advanced toggle", () => {
    const d = renderInDraft(<ThemeSettings />);

    // Every manual field is collapsed by default; the toggle reveals both the
    // grouped colour controls and the raw-CSS expert fields.
    expect(screen.queryByRole("textbox", { name: "Brand name" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Ticker background (CSS)" })).toBeNull();
    revealAdvanced();
    expect(screen.getByRole("textbox", { name: "Brand name" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Ticker background (CSS)" })).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Ticker background (CSS)" }), {
      target: { value: "linear-gradient(#000, #111)" },
    });
    expect(d.last()).toEqual({ themeOverrides: { tickerBg: "linear-gradient(#000, #111)" } });
  });

  it("persists panel and locator palette overrides from the clearly labelled groups", () => {
    const d = renderInDraft(<ThemeSettings />);
    revealAdvanced();

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

    expect(d.last()).toEqual({
      themeOverrides: {
        godsPanelTopColor: "#112233",
        minimapLandColor: "#445566",
        tileColor: "#223344",
        mapHighlightColor: "#abcdef",
      },
    });
  });

  it("Reset overrides clears themeOverrides when some are set", () => {
    const d = renderInDraft(<ThemeSettings />, { state: { themeOverrides: { name: "ZED" } } });

    fireEvent.click(screen.getByRole("button", { name: "Reset overrides" }));
    expect(d.last()).toEqual({ themeOverrides: {} });
  });

  it("resets the preset, overrides, and main-map palette to the default theme", () => {
    const d = renderInDraft(<ThemeSettings />, {
      state: {
        broadcastTheme: "storm",
        themeOverrides: { accent: "#ff00ff" },
        basemapColors: { ocean: "#111111", land: "#222222", border: "#333333" },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to default theme" }));
    expect(d.last()).toEqual({
      broadcastTheme: "command",
      themeOverrides: {},
      basemapColors: { ocean: "#080e18", land: "#1c222e", border: "#dce4f0" },
    });
  });

  it("stages main-map vector colours from the scene theme form", () => {
    const d = renderInDraft(<ThemeSettings />);
    revealAdvanced();

    fireEvent.change(screen.getByLabelText("Ocean"), { target: { value: "#123456" } });
    expect(d.last()).toEqual({
      basemapColors: { ...DEFAULT_CONTROL_STATE.basemapColors, ocean: "#123456" },
    });
  });

  it("opens the two-colour generator in a preview dialog and applies its coordinated palette", () => {
    const d = renderInDraft(<ThemeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Generate palette…" }));

    const dialog = screen.getByRole("dialog", { name: "Generate scene palette" });
    expect(within(dialog).getByLabelText("Theme preview")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Palette highlight" }), {
      target: { value: "#ff6600" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Palette dark base" }), {
      target: { value: "#101820" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply generated palette" }));

    expect(d.last()).toEqual({
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

  it("lets the generator leave map, locator, and existing text colours alone", () => {
    const d = renderInDraft(<ThemeSettings />, {
      state: { themeOverrides: { textColor: "#abcdef" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate palette…" }));
    const dialog = screen.getByRole("dialog", { name: "Generate scene palette" });

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Generate text colours" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include main map" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Include locator globe" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply generated palette" }));

    const applied = d.last();
    expect(applied).not.toHaveProperty("basemapColors");
    expect(applied.themeOverrides).toMatchObject({ textColor: "#abcdef" });
    expect(applied.themeOverrides).not.toHaveProperty("mapHighlightColor");
    expect(applied.themeOverrides).not.toHaveProperty("minimapAccentColor");
  });
});
