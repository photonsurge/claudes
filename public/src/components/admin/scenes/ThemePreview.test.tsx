/**
 * ThemePreview — real broadcast chrome on an admin stage, driven entirely by the
 * theme it's handed (the DRAFT, not the saved state), via BroadcastThemeContext.
 */
import { render, screen, within } from "@testing-library/react";
import { getBroadcastTheme } from "../../broadcast/config";
import ThemePreview from "./ThemePreview";

describe("ThemePreview", () => {
  it("renders the resolved brand through the real chrome components", () => {
    const theme = getBroadcastTheme("command", { name: "ZED CHANNEL", tickerTitle: "ZED TAPE" });
    render(<ThemePreview theme={theme} />);

    const stage = screen.getByLabelText("Theme preview");
    expect(within(stage).getByText("ZED CHANNEL")).toBeInTheDocument();
    expect(within(stage).getByText("ZED TAPE")).toBeInTheDocument();
    // The masthead is live in the preview so the LIVE badge is visible.
    expect(within(stage).getByText("LIVE")).toBeInTheDocument();
    expect(within(stage).getByText("ON AIR")).toBeInTheDocument();
  });

  it("draft ink tokens land on the sample header", () => {
    const theme = getBroadcastTheme("command", { titleColor: "#123456" });
    render(<ThemePreview theme={theme} />);

    expect(screen.getByText("WORLD REPORT")).toHaveStyle({ color: "rgb(18, 52, 86)" });
  });
});
