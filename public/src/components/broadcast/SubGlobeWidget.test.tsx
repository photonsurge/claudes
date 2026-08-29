import { act, render, screen, waitFor } from "@testing-library/react";
import SubGlobeWidget from "./SubGlobeWidget";
import { DEFAULT_THEME } from "./config";

// One little square continent — enough to exercise the land path end-to-end
// without the 2MB Natural Earth fetch.
jest.mock("./subglobe-land", () => ({
  loadSubGlobeLand: jest.fn(() =>
    Promise.resolve([
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ],
    ]),
  ),
}));

// jsdom has no canvas — hand the widget a recording 2d stub.
const ctxStub = () => ({
  clearRect: jest.fn(),
  createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  beginPath: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  save: jest.fn(),
  clip: jest.fn(),
  restore: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  closePath: jest.fn(),
  stroke: jest.fn(),
});

describe("SubGlobeWidget", () => {
  let getContext: jest.SpyInstance;
  let stub: ReturnType<typeof ctxStub>;

  beforeEach(() => {
    stub = ctxStub();
    getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(stub as unknown as RenderingContext);
  });

  afterEach(() => {
    getContext.mockRestore();
  });

  it("renders the locator planet, paints once the land loads, and shows the readout", async () => {
    const { unmount } = render(<SubGlobeWidget center={[-149.9, -17.5]} zoom={3} accent="#38bdf8" />);
    // Anchor readout — southern/western hemispheres formatted.
    expect(screen.getByText("17.5°S · 149.9°W")).toBeInTheDocument();
    // The land promise resolves → a real frame is painted.
    await waitFor(() => expect(stub.clearRect).toHaveBeenCalled());
    expect(stub.lineTo).toHaveBeenCalled();
    unmount(); // interval cleared without leaking a timer past teardown
  });

  it("hides the readout for the in-logo variant (canvas only)", async () => {
    const { unmount } = render(<SubGlobeWidget center={[-149.9, -17.5]} zoom={3} showReadout={false} />);
    expect(screen.queryByText("17.5°S · 149.9°W")).not.toBeInTheDocument();
    // The planet itself still paints.
    await waitFor(() => expect(stub.clearRect).toHaveBeenCalled());
    await act(async () => {}); // flush the land promise while the ctx stub is live
    unmount();
  });

  it("survives a lost/absent 2d context (jsdom default) without crashing", async () => {
    getContext.mockReturnValue(null as unknown as RenderingContext);
    render(<SubGlobeWidget center={[0, 20]} zoom={2.5} />);
    expect(screen.getByText("20.0°N · 0.0°E")).toBeInTheDocument();
    // Flush the mocked land promise inside act so its setState is covered.
    await act(async () => {});
  });

  it("repaints immediately when the scene minimap palette changes", async () => {
    const { rerender, unmount } = render(
      <SubGlobeWidget center={[0, 20]} zoom={2.5} theme={DEFAULT_THEME} />,
    );
    await waitFor(() => expect(stub.clearRect).toHaveBeenCalled());
    await act(async () => {});
    stub.clearRect.mockClear();

    rerender(
      <SubGlobeWidget
        center={[0, 20]}
        zoom={2.5}
        theme={{ ...DEFAULT_THEME, minimapLandColor: "#ff00ff" }}
      />,
    );
    expect(stub.clearRect).toHaveBeenCalled();
    unmount();
  });
});
