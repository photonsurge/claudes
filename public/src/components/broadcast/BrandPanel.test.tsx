import { act, render, screen } from "@testing-library/react";
import BrandPanel from "./BrandPanel";
import { BROADCAST_THEMES } from "./config";

// The live-globe case mounts SubGlobeWidget — keep it off the network.
jest.mock("./subglobe-land", () => ({
  loadSubGlobeLand: jest.fn(() => Promise.resolve([])),
}));

describe("BrandPanel", () => {
  it("does not duplicate LIVE or map status beneath the brand", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByText("MAP")).not.toBeInTheDocument();
  });

  it("renders the scene-coloured G.O.D.S. vector banner", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    const banner = screen.getByRole("img", {
      name: "G.O.D.S. Global Orbital Detection System",
    });
    expect(banner.tagName).toBe("svg");
    expect(banner).toHaveAttribute("width", "760");
    expect(banner.querySelector(`[stroke="${BROADCAST_THEMES.command.accent}"]`)).toBeInTheDocument();
    // Without liveGlobe there's no live canvas and no aperture mask.
    expect(banner.querySelector("mask")).not.toBeInTheDocument();
  });

  it("applies the scene theme's dedicated G.O.D.S. palette", () => {
    const theme = {
      ...BROADCAST_THEMES.command,
      godsPanelTopColor: "#112233",
      godsPanelMidColor: "#223344",
      godsPanelBottomColor: "#334455",
      godsBorderColor: "#445566",
    };
    render(<BrandPanel theme={theme} />);
    const banner = screen.getByRole("img");

    for (const color of ["#112233", "#223344", "#334455"]) {
      expect(banner.querySelector(`stop[stop-color="${color}"]`)).toBeInTheDocument();
    }
    expect(banner.querySelector(`path[stroke="${theme.godsBorderColor}"]`)).toBeInTheDocument();
  });

  it("embeds the live locator globe behind the banner when liveGlobe is set", async () => {
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null as unknown as RenderingContext);
    const { container } = render(
      <BrandPanel
        theme={BROADCAST_THEMES.command}
        liveGlobe={{ center: [167.835, -15.389], zoom: 2.5 }}
        ticker="UP NEXT · EARTHQUAKE M5.0"
        nextCutAt={Date.now() + 125_000}
        channels={["SEISMIC"]}
      />,
    );
    const banner = screen.getByRole("img", {
      name: "G.O.D.S. Global Orbital Detection System",
    });
    expect(banner).toHaveAttribute("width", "760");
    // Canvas layered behind the svg; the panel carries the aperture mask.
    expect(container.querySelector("canvas")).toBeInTheDocument();
    expect(banner.querySelector('[data-layer="panel"]')?.getAttribute("mask")).toMatch(/^url\(/);
    // The camera anchor doubles as the status-row coordinate readout.
    expect(screen.getByText("-15.389")).toBeInTheDocument();
    expect(screen.getByText("167.835")).toBeInTheDocument();
    expect(screen.getByText("UP NEXT · EARTHQUAKE M5.0")).toBeInTheDocument();
    // The channel chip is the scene's display name, not a hardcoded set.
    expect(screen.getByText("SEISMIC")).toBeInTheDocument();
    // The next-cut countdown rides the tape row's right edge.
    expect(screen.getByText(/NEXT IN 02:0[3-5]/)).toBeInTheDocument();
    await act(async () => {}); // flush the mocked land promise's setState
    getContext.mockRestore();
  });

  it("no longer carries the world clocks (they ride the masthead map plate)", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.queryByText("LONDON")).not.toBeInTheDocument();
    expect(screen.queryByText("MOSCOW")).not.toBeInTheDocument();
  });

  it("renders theme text for non-G.O.D.S. themes", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.storm} />);
    expect(screen.getByText("STORM WATCH LIVE")).toBeInTheDocument();
    expect(screen.getByText("SEVERE WEATHER OPERATIONS")).toBeInTheDocument();
  });
});
