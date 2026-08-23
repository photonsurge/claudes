import { render, screen } from "@testing-library/react";
import { BroadcastThemeContext } from "./theme-context";
import { DEFAULT_THEME } from "./config";
import BroadcastCard, { CardEyebrow, CardSection, DeckChromeContext } from "./BroadcastCard";

describe("BroadcastCard", () => {
  it("renders its children", () => {
    render(<BroadcastCard>hello body</BroadcastCard>);
    expect(screen.getByText("hello body")).toBeInTheDocument();
  });

  it("shows a kind badge when given one", () => {
    render(<BroadcastCard badge="Seismic">x</BroadcastCard>);
    expect(screen.getByText("Seismic")).toBeInTheDocument();
  });

  it("shows the ON AIR pulse only when live", () => {
    const { rerender } = render(<BroadcastCard badge="Country">x</BroadcastCard>);
    expect(screen.queryByText("ON AIR")).not.toBeInTheDocument();
    rerender(<BroadcastCard badge="Country" live>x</BroadcastCard>);
    expect(screen.getByText("ON AIR")).toBeInTheDocument();
  });

  it("prefixes the eyebrow with the ▸ marker and renders header-right content", () => {
    render(<BroadcastCard eyebrow="Seismic Report" headerRight={<span>chip</span>}>x</BroadcastCard>);
    expect(screen.getByText(/Seismic Report/)).toHaveTextContent("▸ Seismic Report");
    expect(screen.getByText("chip")).toBeInTheDocument();
  });

  it("inside a deck, the template overrides the panel's own header (badge + title, no ON AIR)", () => {
    render(
      <DeckChromeContext.Provider value={{ badge: "Aircraft", title: "Air Force One", accent: "#2aa6c0" }}>
        {/* This card asks for an eyebrow + live ON AIR, but the deck template wins. */}
        <BroadcastCard eyebrow="Seismic Report" live>
          body content
        </BroadcastCard>
      </DeckChromeContext.Provider>,
    );
    expect(screen.getByText("Aircraft")).toBeInTheDocument();
    expect(screen.getByText("Air Force One")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
    // Template suppresses the panel's own eyebrow + the ON AIR pulse.
    expect(screen.queryByText(/Seismic Report/)).not.toBeInTheDocument();
    expect(screen.queryByText("ON AIR")).not.toBeInTheDocument();
  });

  it("CardSection renders its eyebrow and children", () => {
    render(
      <BroadcastCard>
        <CardSection eyebrow="Nearest Cities">rows</CardSection>
      </BroadcastCard>,
    );
    expect(screen.getByText("Nearest Cities")).toBeInTheDocument();
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});

describe("BroadcastCard theming", () => {
  const themed = { ...DEFAULT_THEME, mutedColor: "#123456", textColor: "#654321" };

  it("follows the channel theme from context (the 13 theme-blind panels get it free)", () => {
    render(
      <BroadcastThemeContext.Provider value={themed}>
        <BroadcastCard eyebrow="Seismic Report">body</BroadcastCard>
      </BroadcastThemeContext.Provider>,
    );
    // Eyebrow follows the themed muted ink, card body the themed text ink.
    expect(screen.getByText(/Seismic Report/)).toHaveStyle({ color: "rgb(18, 52, 86)" });
    expect(screen.getByText("body").closest("div")).toBeInTheDocument();
  });

  it("an explicit theme prop beats the context", () => {
    const propTheme = { ...DEFAULT_THEME, mutedColor: "#00ff00" };
    render(
      <BroadcastThemeContext.Provider value={themed}>
        <BroadcastCard eyebrow="Track Info" theme={propTheme}>x</BroadcastCard>
      </BroadcastThemeContext.Provider>,
    );
    expect(screen.getByText(/Track Info/)).toHaveStyle({ color: "rgb(0, 255, 0)" });
  });

  it("a bare CardEyebrow reads the context too", () => {
    render(
      <BroadcastThemeContext.Provider value={themed}>
        <CardEyebrow>Nearby</CardEyebrow>
      </BroadcastThemeContext.Provider>,
    );
    expect(screen.getByText("Nearby")).toHaveStyle({ color: "rgb(18, 52, 86)" });
  });
});
