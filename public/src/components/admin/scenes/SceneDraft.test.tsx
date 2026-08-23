/**
 * SceneDraft — the settings page's draft buffer. Cards stage deltas; NOTHING is
 * patched until Save, which applies the whole accumulated draft as one patch
 * (restamping spinEpoch at apply time). Discard drops the draft and bumps
 * `epoch` so cards refetch. Without a provider, staging falls back to the live
 * patcher (old behaviour). Director-config deltas ride a second bucket
 * (`stageDirector`) that shares the same Save bar but PATCHes the director
 * route instead.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import SceneDraftProvider, { useSceneDraft } from "./SceneDraft";

const patch = jest.fn();
jest.mock("../../../lib/scenes", () => ({
  useScenePatcher: () => patch,
}));

const patchDirector = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock("../../../lib/director", () => ({
  patchDirectorConfig: (...args: unknown[]) => patchDirector(...args),
}));

/** Stand-in settings card: stages deltas in both buckets and shows the epoch. */
function Card() {
  const { stage, stageDirector, epoch } = useSceneDraft();
  return (
    <div>
      <span data-testid="epoch">{epoch}</span>
      <button onClick={() => stage("wind", { widgetsOff: ["seismic"] })}>hide widget</button>
      <button onClick={() => stage("wind", { slideHoldMs: 8000, spinEpoch: 123 })}>set dwell</button>
      <button onClick={() => stageDirector("wind", { countries: ["uk"] })}>set countries</button>
      <button onClick={() => stageDirector("wind", { regions: ["iberia"] })}>set regions</button>
    </div>
  );
}

beforeEach(() => {
  patch.mockClear();
  patchDirector.mockClear();
});

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
    // Nothing was staged for the director — its PATCH must not fire.
    expect(patchDirector).not.toHaveBeenCalled();

    // Saved — the bar goes away.
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it("director deltas share the Save bar but go to the director route only", () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <Card />
      </SceneDraftProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "set regions" }));

    // Staged only — the bar is up, nothing has been PATCHed anywhere.
    expect(patchDirector).not.toHaveBeenCalled();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // One merged director PATCH; the scene patcher stays untouched.
    expect(patchDirector).toHaveBeenCalledTimes(1);
    expect(patchDirector).toHaveBeenCalledWith("wind", {
      countries: ["uk"],
      regions: ["iberia"],
    });
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it("Save sends both buckets when both are staged", () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <Card />
      </SceneDraftProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));
    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(patch).toHaveBeenCalledWith("wind", { widgetsOff: ["seismic"] });
    expect(patchDirector).toHaveBeenCalledWith("wind", { countries: ["uk"] });
  });

  it("Discard drops the draft and bumps epoch so cards refetch", () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <Card />
      </SceneDraftProvider>,
    );

    expect(screen.getByTestId("epoch")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));
    fireEvent.click(screen.getByRole("button", { name: "set countries" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(patch).not.toHaveBeenCalled();
    expect(patchDirector).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
    expect(screen.getByTestId("epoch")).toHaveTextContent("1");
  });

  it("falls back to the live patcher when no provider wraps the card", () => {
    render(<Card />);

    fireEvent.click(screen.getByRole("button", { name: "hide widget" }));
    fireEvent.click(screen.getByRole("button", { name: "set countries" }));

    expect(patch).toHaveBeenCalledWith("wind", { widgetsOff: ["seismic"] });
    // Director staging falls back to an immediate PATCH the same way.
    expect(patchDirector).toHaveBeenCalledWith("wind", { countries: ["uk"] });
  });
});
