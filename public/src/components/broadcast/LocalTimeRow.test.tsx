import { render, screen, act } from "@testing-library/react";
import { zoneFromCity, zoneFromLongitude } from "@photonsurge/shared/time/local-zone";
import type { SegmentKind } from "@photonsurge/shared/director";
import LocalTimeRow, { showsLocalTime } from "./LocalTimeRow";

/** 12:00 UTC on a Thursday in January. */
const AT = new Date("2026-01-15T12:00:00Z");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AT);
});
afterEach(() => {
  jest.useRealTimers();
});

describe("showsLocalTime", () => {
  const kinds = (...k: SegmentKind[]) => k.map(showsLocalTime);

  it("covers the placed kinds a viewer can picture", () => {
    expect(kinds("country", "storm", "quake", "volcano")).toEqual([true, true, true, true]);
  });

  it("leaves out wide shots and the kinds that cross zones mid-shot", () => {
    expect(kinds("global", "intro", "ocean", "orbital", "region", "flight", "ship")).not.toContain(true);
  });
});

describe("LocalTimeRow", () => {
  it("renders nothing without a zone", () => {
    const { container } = render(<LocalTimeRow zone={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the place's clock, local weekday and offset", () => {
    render(<LocalTimeRow zone={zoneFromCity("Asia/Tokyo", 139.7, "Tokyo")} />);
    act(() => void jest.advanceTimersByTime(0));
    expect(screen.getByText("LOCAL TIME")).toBeInTheDocument();
    expect(screen.getByText("21:00")).toBeInTheDocument();
    expect(screen.getByText("THU · UTC+9 · Tokyo")).toBeInTheDocument();
  });

  it("marks a longitude-derived clock as approximate", () => {
    render(<LocalTimeRow zone={zoneFromLongitude(-150)} />);
    act(() => void jest.advanceTimersByTime(0));
    expect(screen.getByText("02:00")).toBeInTheDocument();
    expect(screen.getByText("THU · UTC-10 approx")).toBeInTheDocument();
  });

  it("ticks the minute over", () => {
    render(<LocalTimeRow zone={zoneFromCity("Europe/London", -0.1, "London")} />);
    act(() => void jest.advanceTimersByTime(0));
    expect(screen.getByText("12:00")).toBeInTheDocument();
    act(() => void jest.advanceTimersByTime(61_000));
    expect(screen.getByText("12:01")).toBeInTheDocument();
  });

  it("stops ticking once unmounted", () => {
    const { unmount } = render(<LocalTimeRow zone={zoneFromCity("Europe/London", -0.1)} />);
    act(() => void jest.advanceTimersByTime(0));
    unmount();
    expect(() => act(() => void jest.advanceTimersByTime(5_000))).not.toThrow();
  });
});
