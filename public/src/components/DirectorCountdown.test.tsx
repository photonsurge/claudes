import { render, screen, fireEvent, act } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import DirectorCountdown from "./DirectorCountdown";

// startAt is a wall-clock target; drive the clock with fake timers so we can
// watch the countdown cross zero.
const armed = (startAt: number | null): ControlState => ({ ...DEFAULT_CONTROL_STATE, startAt });

beforeEach(() => jest.useFakeTimers({ now: 0 }));
afterEach(() => jest.useRealTimers());

describe("DirectorCountdown", () => {
  it("hands the show to the auto-director when the countdown reaches zero", () => {
    const startDirector = jest.fn();
    render(<DirectorCountdown liveState={armed(1000)} applyLive={jest.fn()} auto={false} startDirector={startDirector} />);

    // Still counting down — the director must not start yet.
    act(() => void jest.advanceTimersByTime(500));
    expect(startDirector).not.toHaveBeenCalled();

    // Cross zero.
    act(() => void jest.advanceTimersByTime(500));
    expect(startDirector).toHaveBeenCalledTimes(1);

    // Fires once, not on every subsequent tick.
    act(() => void jest.advanceTimersByTime(2000));
    expect(startDirector).toHaveBeenCalledTimes(1);
  });

  it("does not restart the director if it is already running", () => {
    const startDirector = jest.fn();
    render(<DirectorCountdown liveState={armed(1000)} applyLive={jest.fn()} auto startDirector={startDirector} />);

    act(() => void jest.advanceTimersByTime(2000));
    expect(startDirector).not.toHaveBeenCalled();
  });

  it("'Go live now' ends the countdown and starts the director immediately", () => {
    const applyLive = jest.fn();
    const startDirector = jest.fn();
    render(<DirectorCountdown liveState={armed(5000)} applyLive={applyLive} auto={false} startDirector={startDirector} />);

    fireEvent.click(screen.getByText("Go live now"));

    expect(applyLive).toHaveBeenCalledWith(expect.objectContaining({ startAt: null }));
    expect(startDirector).toHaveBeenCalledTimes(1);
  });

  it("arming a countdown does not start the director on its own", () => {
    const applyLive = jest.fn();
    const startDirector = jest.fn();
    render(<DirectorCountdown liveState={armed(null)} applyLive={applyLive} auto={false} startDirector={startDirector} />);

    fireEvent.click(screen.getByText("Start countdown ▶"));

    // Start countdown only writes startAt; the director stays off until zero.
    expect(applyLive).toHaveBeenCalledWith(expect.objectContaining({ startAt: expect.any(Number) }));
    expect(startDirector).not.toHaveBeenCalled();
  });
});
