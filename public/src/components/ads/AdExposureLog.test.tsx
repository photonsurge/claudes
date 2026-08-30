/**
 * AdExposureLog — the per-ad EXPOSURE LOG: window rows (surface · scene ·
 * range · duration), ON AIR badge on open windows, and nothing at all for an
 * ad with no history.
 */
import { render, screen, waitFor } from "@testing-library/react";
import AdExposureLog, { fmtWindowMs, fmtWindowRange } from "./AdExposureLog";
import * as client from "../../lib/ads/client";

jest.mock("../../lib/ads/client", () => ({ getAdExposure: jest.fn() }));
const getAdExposure = client.getAdExposure as jest.Mock;

const T0 = Date.parse("2026-08-28T14:02:00Z");
const MIN = 60_000;

describe("fmtWindowMs / fmtWindowRange", () => {
  it("scales seconds → minutes → hours", () => {
    expect(fmtWindowMs(20_000)).toBe("20s");
    expect(fmtWindowMs(98 * MIN)).toBe("1h 38m");
  });

  it("renders open windows as '→ now'", () => {
    expect(fmtWindowRange({ startedAt: T0 })).toMatch(/→ now$/);
    expect(fmtWindowRange({ startedAt: T0, endedAt: T0 + 98 * MIN })).toMatch(/→ /);
  });
});

describe("AdExposureLog", () => {
  it("renders one row per window with the ON AIR badge on the open one", async () => {
    getAdExposure.mockResolvedValue([
      { sceneId: "default", sceneName: "Main", surface: "ticker", startedAt: T0, ms: 10 * MIN },
      { sceneId: "storm", sceneName: "Storm Watch", surface: "billboard", startedAt: T0 - 120 * MIN, endedAt: T0 - 30 * MIN, ms: 90 * MIN },
    ]);
    render(<AdExposureLog adId="ad-1" />);

    await waitFor(() => expect(screen.getByText("EXPOSURE LOG")).toBeInTheDocument());
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByText("CRAWL")).toBeInTheDocument();
    expect(screen.getByText("BILLBOARD")).toBeInTheDocument();
    expect(screen.getByText("Storm Watch")).toBeInTheDocument();
    expect(screen.getAllByText("● ON AIR")).toHaveLength(1);
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("renders nothing for an ad with no windows", async () => {
    getAdExposure.mockResolvedValue([]);
    const { container } = render(<AdExposureLog adId="ad-2" />);
    await waitFor(() => expect(getAdExposure).toHaveBeenCalledWith("ad-2"));
    expect(container).toBeEmptyDOMElement();
  });
});
