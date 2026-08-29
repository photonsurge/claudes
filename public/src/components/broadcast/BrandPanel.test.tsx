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
    expect(banner).toHaveAttribute("width", "620");
    expect(banner.querySelector(`[stroke="${BROADCAST_THEMES.command.accent}"]`)).toBeInTheDocument();
    // Without liveGlobe the static artwork core stays intact.
    expect(banner.querySelector('[data-layer="continents"]')).toBeInTheDocument();
  });

  it("embeds the live locator globe behind the banner when liveGlobe is set", async () => {
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null as unknown as RenderingContext);
    const { container } = render(
      <BrandPanel theme={BROADCAST_THEMES.command} liveGlobe={{ center: [0, 20], zoom: 2.5 }} />,
    );
    const banner = screen.getByRole("img", {
      name: "G.O.D.S. Global Orbital Detection System",
    });
    expect(banner).toHaveAttribute("width", "620");
    // Canvas layered behind the svg; the static core is punched out for it.
    expect(container.querySelector("canvas")).toBeInTheDocument();
    expect(banner.querySelector('[data-layer="continents"]')).not.toBeInTheDocument();
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
