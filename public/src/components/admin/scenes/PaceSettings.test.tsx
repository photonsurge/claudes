/**
 * PaceSettings — the per-channel reading-pace control (readPaceCps). One slider,
 * staged as a delta, with the pace shown back in both units.
 */
import { fireEvent, screen } from "@testing-library/react";
import { DEFAULT_READ_CPS, READ_CPS_MAX } from "@photonsurge/shared/reading-pace";
import PaceSettings from "./PaceSettings";
import { renderInDraft } from "./draft-harness";

describe("PaceSettings", () => {
  it("shows the channel's pace in characters/sec and words/min", () => {
    renderInDraft(<PaceSettings />);
    expect(screen.getByRole("slider", { name: "Reading pace" })).toHaveValue(String(DEFAULT_READ_CPS));
    expect(screen.getByText(/characters\/sec/)).toHaveTextContent(
      `${DEFAULT_READ_CPS} characters/sec · 150 words/min`,
    );
  });

  it("stages a new pace", () => {
    const d = renderInDraft(<PaceSettings />);
    fireEvent.change(screen.getByRole("slider", { name: "Reading pace" }), { target: { value: "9" } });

    expect(d.last()).toEqual({ readPaceCps: 9 });
  });

  it("reads a pace back from the channel state, clamped", () => {
    renderInDraft(<PaceSettings />, { state: { readPaceCps: 900 } });
    expect(screen.getByRole("slider", { name: "Reading pace" })).toHaveValue(String(READ_CPS_MAX));
  });
});
