/**
 * SceneDraft — the settings page's draft buffer. Cards stage deltas; NOTHING is
 * patched until Save, which applies the whole accumulated draft as one patch
 * (restamping spinEpoch at apply time). Discard drops the draft and bumps
 * `epoch` so cards refetch. Without a provider, staging falls back to the live
 * patcher (old behaviour).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import SceneDraftProvider, { useSceneDraft } from "./SceneDraft";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  useScenePatcher: () => patch,
}));

/** Stand-in settings card: stages two deltas and shows the refetch epoch. */
function Card() {
  const { stage, epoch } = useSceneDraft();
  return (
    <div>
      <span data-testid="epoch">{epoch}</span>
      <button onClick={() => stage("wind", { widgetsOff: ["seismic"] })}>hide widget</button>
      <button onClick={() => stage("wind", { slideHoldMs: 8000, spinEpoch: 123 })}>set dwell</button>
    </div>
  );
}

beforeEach(() => patch.mockClear());

describe("SceneDraftProvider", () => {
  it("stages changes without patching, then Save applies them as one merged patch", () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <Card />
      </SceneDraftProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));
    fireEvent.click(screen.getByRole("button", { name: "set dwell" }));

    // Nothing has gone out — the bar is up instead.
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(patch).toHaveBeenCalledTimes(1);
    const [id, sent] = patch.mock.calls[0];
    expect(id).toBe("wind");
    expect(sent.widgetsOff).toEqual(["seismic"]);
    expect(sent.slideHoldMs).toBe(8000);
    // spinEpoch is restamped at apply time, not the staged click-time value.
    expect(sent.spinEpoch).not.toBe(123);

    // Saved — the bar goes away.
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it("Discard drops the draft and bumps epoch so cards refetch", () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <Card />
      </SceneDraftProvider>,
    );

    expect(screen.getByTestId("epoch")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
    expect(screen.getByTestId("epoch")).toHaveTextContent("1");
  });

  it("falls back to the live patcher when no provider wraps the card", () => {
    render(<Card />);

    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));

    expect(patch).toHaveBeenCalledWith("wind", { widgetsOff: ["seismic"] });
  });
});
