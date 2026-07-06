import { render, screen, waitFor } from "@testing-library/react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";

jest.mock("../../lib/depthProfile", () => ({
  sampleDepthProfile: jest.fn(),
}));

import { sampleDepthProfile } from "../../lib/depthProfile";
import DepthProfilePanel, { profileRows } from "./DepthProfilePanel";

const mockSample = sampleDepthProfile as jest.MockedFunction<typeof sampleDepthProfile>;

const manifest = { model: "rtofs" } as unknown as WeatherManifest;

beforeEach(() => {
  mockSample.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DepthProfilePanel", () => {
  it("renders all 5 chapters once sampling resolves", async () => {
    mockSample.mockResolvedValue([
      { depth: 0, tempC: 26.4 },
      { depth: 100, tempC: 21.1 },
      { depth: 500, tempC: 9.8 },
      { depth: 2000, tempC: 3.2 },
      { depth: 5000, tempC: 1.9 },
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

describe("profileRows", () => {
  const at = (depths: number[], temps: number[]) => depths.map((depth, i) => ({ depth, tempC: temps[i] }));

  it("spaces rows evenly by chapter index, not true depth scale", () => {
    const rows = profileRows(at([0, 100, 500, 2000, 5000], [20, 18, 10, 4, 2]))!;
    expect(rows).toHaveLength(5);
    const ys = rows.map((r) => r.y);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    // Evenly spaced: every gap between consecutive rows is equal, regardless
    // of the huge jump from 500m to 2000m vs. 0m to 100m.
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 5);
  });

  it("maps warmer temps to a larger x than colder ones", () => {
    const rows = profileRows(at([0, 5000], [25, 2]))!;
    expect(rows[0].x).toBeGreaterThan(rows[1].x);
  });

  it("centres a flat profile rather than collapsing to one edge", () => {
    const rows = profileRows(at([0, 100, 500], [10, 10, 10]))!;
    const xs = new Set(rows.map((r) => r.x));
    expect(xs.size).toBe(1);
  });

  it("returns null for fewer than 2 points", () => {
    expect(profileRows(at([0], [10]))).toBeNull();
    expect(profileRows([])).toBeNull();
  });
});
