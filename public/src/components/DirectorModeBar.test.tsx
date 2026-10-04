/**
 * DirectorModeBar — the always-visible Auto/Off toggle, Skip and Settings/Log
 * swap. A playing scripted short must not read as off: it shows "Playing a
 * script" with a Stop (mode off), and nothing on the bar offers to flip it to
 * auto mid-play.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { DirectorMode } from "@photonsurge/shared/director";
import DirectorModeBar from "./DirectorModeBar";

const bar = (mode: DirectorMode) => {
  const handlers = { onToggleAuto: jest.fn(), onStop: jest.fn(), onSkip: jest.fn(), onToggleSettings: jest.fn() };
  render(<DirectorModeBar mode={mode} showSettings={false} {...handlers} />);
  return handlers;
};

describe("DirectorModeBar", () => {
  it("off: the Auto toggle, Skip disabled, no settings swap", () => {
    const h = bar("off");
    fireEvent.click(screen.getByRole("button", { name: "○ Auto — Off" }));
    expect(h.onToggleAuto).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Skip ⏭" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "⚙ Settings" })).not.toBeInTheDocument();
  });

  it("auto: the toggle reads ON, Skip and the settings swap are live", () => {
    const h = bar("auto");
    expect(screen.getByRole("button", { name: "● AUTO — ON" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip ⏭" }));
    expect(h.onSkip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "⚙ Settings" })).toBeInTheDocument();
  });

  it("script: reads Playing a script with a Stop, and no Auto toggle or Skip", () => {
    const h = bar("script");
    expect(screen.getByRole("status")).toHaveTextContent("PLAYING A SCRIPT");
    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(h.onToggleAuto).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Auto/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip ⏭" })).not.toBeInTheDocument();
    // The log/settings swap works as it does under auto.
    expect(screen.getByRole("button", { name: "⚙ Settings" })).toBeInTheDocument();
  });
});
