import { render, screen, waitFor } from "@testing-library/react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { Palette } from "@photonsurge/shared/palettes";

jest.mock("../../lib/depthProfile", () => ({
  sampleDepthProfile: jest.fn(),
}));

import { sampleDepthProfile } from "../../lib/depthProfile";
import DepthProfilePanel, { colorAtStop, colorForValue, textColorFor } from "./DepthProfilePanel";

const mockSample = sampleDepthProfile as jest.MockedFunction<typeof sampleDepthProfile>;

const manifest = { model: "rtofs" } as unknown as WeatherManifest;

const VARIABLE_BY_DEPTH: Record<number, string> = { 0: "sst", 100: "sst100", 500: "sst500", 2000: "sst2000", 5000: "sst5000" };

const point = (depth: number, tempC: number, domain: [number, number] = [-2, 32]) => ({
  depth,
  variableId: VARIABLE_BY_DEPTH[depth],
  tempC,
  domain,
  palette: "sst",
});

beforeEach(() => {
  mockSample.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DepthProfilePanel", () => {
  it("renders all 5 chapters as coloured bands once sampling resolves", async () => {
    mockSample.mockResolvedValue([
      point(0, 26.4),
      point(100, 21.1, [-2, 28]),
      point(500, 9.8, [-2, 16]),
      point(2000, 3.2, [-1, 5]),
      point(5000, 1.9, [-1, 3]),
    ]);
    render(<DepthProfilePanel center={[-79.8, 26.1]} manifest={manifest} />);
    await waitFor(() => expect(screen.getByText("SEA TEMP PROFILE")).toBeInTheDocument());
    expect(screen.getByText("SURFACE")).toBeInTheDocument();
    expect(screen.getByText("100m")).toBeInTheDocument();
    expect(screen.getByText("500m")).toBeInTheDocument();
    expect(screen.getByText("2000m")).toBeInTheDocument();
    expect(screen.getByText("5000m")).toBeInTheDocument();
    expect(screen.getByText("26.4°")).toBeInTheDocument();
    expect(screen.getByText("1.9°")).toBeInTheDocument();
  });

  it("highlights the row matching activeVariable, none highlighted when it's null/absent", async () => {
    mockSample.mockResolvedValue([point(0, 26.4), point(100, 21.1), point(500, 9.8)]);
    const { rerender } = render(<DepthProfilePanel center={[-79.8, 26.1]} manifest={manifest} activeVariable="sst500" />);
    await waitFor(() => expect(screen.getByText("500m")).toBeInTheDocument());
    const row500 = screen.getByText("500m").closest("div") as HTMLElement;
    expect(row500.style.boxShadow).toContain("inset 0 0 0 2px");
    const row100 = screen.getByText("100m").closest("div") as HTMLElement;
    expect(row100.style.boxShadow).not.toContain("inset 0 0 0 2px");

    rerender(<DepthProfilePanel center={[-79.8, 26.1]} manifest={manifest} />);
    expect((screen.getByText("500m").closest("div") as HTMLElement).style.boxShadow).not.toContain("inset 0 0 0 2px");
  });

  it("hides entirely when sampling resolves null (land point)", async () => {
    mockSample.mockResolvedValue(null);
    const { container } = render(<DepthProfilePanel center={[10, 50]} manifest={manifest} />);
    await waitFor(() => expect(mockSample).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("hides without a focus point (never calls sampleDepthProfile)", () => {
    const { container } = render(<DepthProfilePanel center={null} manifest={manifest} />);
    expect(container.firstChild).toBeNull();
    expect(mockSample).not.toHaveBeenCalled();
  });
});

describe("colorAtStop", () => {
  const grayscale: Palette = [
    [0, "#000000"],
    [1, "#ffffff"],
  ];

  it("returns the exact stop colour at t=0 and t=1", () => {
    expect(colorAtStop(grayscale, 0)).toBe("#000000");
    expect(colorAtStop(grayscale, 1)).toBe("#ffffff");
  });

  it("linearly interpolates mid-way between stops", () => {
    expect(colorAtStop(grayscale, 0.5)).toBe("#808080");
  });

  it("clamps out-of-range t", () => {
    expect(colorAtStop(grayscale, -5)).toBe("#000000");
    expect(colorAtStop(grayscale, 5)).toBe("#ffffff");
  });
});

describe("colorForValue", () => {
  const grayscale: Palette = [
    [0, "#000000"],
    [1, "#ffffff"],
  ];

  it("maps a physical value onto the palette via its domain", () => {
    expect(colorForValue(grayscale, [0, 100], 0)).toBe("#000000");
    expect(colorForValue(grayscale, [0, 100], 100)).toBe("#ffffff");
    expect(colorForValue(grayscale, [0, 100], 50)).toBe("#808080");
  });

  it("colours the SAME temperature differently under different domains", () => {
    // 10°C reads near the warm end of a -2..16 domain but the cold end of a -2..32 one.
    const warmRead = colorForValue(grayscale, [-2, 16], 10);
    const coldRead = colorForValue(grayscale, [-2, 32], 10);
    expect(warmRead).not.toBe(coldRead);
  });
});

describe("textColorFor", () => {
  it("picks dark text on light backgrounds and light text on dark ones", () => {
    expect(textColorFor("#ffffff")).toBe("#0a0e16");
    expect(textColorFor("#000000")).toBe("#f3f7ff");
  });
});
