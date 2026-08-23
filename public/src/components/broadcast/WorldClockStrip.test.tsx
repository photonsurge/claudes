import { render, screen } from "@testing-library/react";
import { act } from "react";
import WorldClockStrip from "./WorldClockStrip";
import { BROADCAST_THEMES } from "./config";

describe("WorldClockStrip", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renders the five global city clocks", () => {
    render(<WorldClockStrip theme={BROADCAST_THEMES.command} />);
    expect(screen.getByText("LONDON")).toBeInTheDocument();
    expect(screen.getByText("NEW YORK")).toBeInTheDocument();
    expect(screen.getByText("BEIJING")).toBeInTheDocument();
    expect(screen.getByText("TOKYO")).toBeInTheDocument();
    expect(screen.getByText("MOSCOW")).toBeInTheDocument();
  });

  it("fills in ticking HH:MM:SS readings after mount", () => {
    render(<WorldClockStrip theme={BROADCAST_THEMES.command} />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // Every city shows a real time, no placeholder left.
    expect(screen.queryByText("--:--:--")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^\d{2}:\d{2}:\d{2}$/)).toHaveLength(5);
  });
});
