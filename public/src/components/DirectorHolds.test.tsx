import { render, screen, fireEvent } from "@testing-library/react";
import {
  DEFAULT_DIRECTOR_CONFIG,
  SEGMENT_KINDS,
  type DirectorConfig,
  type SegmentKind,
} from "@photonsurge/shared/director";
import { KIND_LABEL } from "../lib/kind-labels";
import DirectorHolds from "./DirectorHolds";

// A config with exactly one kind enabled, so the row (and its single seconds
// box) is unambiguous to query.
const onlyKind = (kind: SegmentKind): DirectorConfig => ({
  ...DEFAULT_DIRECTOR_CONFIG,
  kinds: Object.fromEntries(SEGMENT_KINDS.map((k) => [k, k === kind])) as DirectorConfig["kinds"],
});

describe("DirectorHolds typed seconds override", () => {
  it("commits a typed hold far beyond the slider range on blur", () => {
    const update = jest.fn();
    render(<DirectorHolds sceneId="default" config={onlyKind("global")} update={update} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1200" } });
    // Draft only — half-typed numbers must never reach the live director.
    expect(update).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ kindHoldSeconds: { global: 1200 } });
  });

  it("commits once on Enter", () => {
    const update = jest.fn();
    render(<DirectorHolds sceneId="default" config={onlyKind("global")} update={update} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "600" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // Enter blurs in the browser; the follow-up blur must not re-commit

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ kindHoldSeconds: { global: 600 } });
  });

  it("discards empty or below-floor entries", () => {
    const update = jest.fn();
    render(<DirectorHolds sceneId="default" config={onlyKind("global")} update={update} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);

    expect(update).not.toHaveBeenCalled();
    // The box snaps back to the live value.
    expect(input).toHaveValue(DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds.global);
  });

  it("per-level rows commit typed overrides too", () => {
    const update = jest.fn();
    render(<DirectorHolds sceneId="default" config={onlyKind("quake")} update={update} />);

    // Strongest band first — the top spinbutton is the Great (M8+) hold.
    const input = screen.getAllByRole("spinbutton")[0];
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    expect(update).toHaveBeenCalledWith({ quakeHoldSeconds: { great: 900 } });
  });
});

describe("DirectorHolds holds-only rows", () => {
  it("renders rows only for enabled kinds — no enable checkboxes", () => {
    render(<DirectorHolds sceneId="default" config={onlyKind("global")} update={jest.fn()} />);

    expect(screen.getByText(KIND_LABEL.global)).toBeInTheDocument();
    expect(screen.queryByText(KIND_LABEL.country)).not.toBeInTheDocument();
    expect(screen.queryByText(KIND_LABEL.ship)).not.toBeInTheDocument();
    // Which kinds air moved to the channel admin page — no checkboxes here.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("links the hint to the channel's admin settings page", () => {
    render(<DirectorHolds sceneId="my-scene" config={onlyKind("global")} update={jest.fn()} />);

    const link = screen.getByRole("link", { name: "Channel settings" });
    expect(link).toHaveAttribute("href", "/admin/scenes/my-scene#director");
  });

  it("shows an empty note when no kinds are enabled", () => {
    const none: DirectorConfig = {
      ...DEFAULT_DIRECTOR_CONFIG,
      kinds: Object.fromEntries(SEGMENT_KINDS.map((k) => [k, false])) as DirectorConfig["kinds"],
    };
    render(<DirectorHolds sceneId="default" config={none} update={jest.fn()} />);

    expect(screen.getByText(/No slide types are enabled/)).toBeInTheDocument();
  });
});
