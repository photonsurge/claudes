/**
 * DirectorSettings — the per-channel auto-director CONTENT card: which slide
 * types (kinds) air + their frequency, country/area favourites and one-click
 * presets. Everything stages COMPLETE top-level DirectorConfig fields into the
 * page's draft, so the shallow-merging Save can't drop a sibling.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { DIRECTOR_PRESETS } from "@photonsurge/shared/director-presets";
import DirectorSettings from "./DirectorSettings";
import { renderInDraft } from "./draft-harness";

const mockPatchDirector = jest.fn();
jest.mock("../../../lib/director", () => ({
  ...jest.requireActual("../../../lib/director"),
  patchDirectorConfig: (...a: unknown[]) => mockPatchDirector(...a),
}));

beforeEach(() => mockPatchDirector.mockReset().mockResolvedValue({}));

describe("DirectorSettings", () => {
  it("toggling a kind stages the COMPLETE kinds record", () => {
    const d = renderInDraft(<DirectorSettings />);

    const ships = screen.getByRole("checkbox", { name: "Ships" });
    expect(ships).toBeChecked();
    fireEvent.click(ships);

    expect(d.stagedDirector).toHaveLength(1);
    expect(d.lastDirector().kinds).toEqual({ ...DEFAULT_DIRECTOR_CONFIG.kinds, ship: false });
  });

  it("ticking a country stages the full favourites array", () => {
    const d = renderInDraft(<DirectorSettings />);

    const france = screen.getByRole("checkbox", { name: "🇫🇷 France" });
    expect(france).not.toBeChecked();
    fireEvent.click(france);

    // Defaults (uk, japan) survive — the patch carries the whole list.
    expect(new Set(d.lastDirector().countries)).toEqual(new Set(["uk", "japan", "france"]));
  });

  it("keeps the areas picker editable while its kind is off, with a hint", () => {
    const d = renderInDraft(<DirectorSettings />);

    // `region` is off by default → the info hint shows…
    expect(screen.getAllByText(/won't air until it's enabled above/).length).toBeGreaterThan(0);

    // …but the picker still stages edits (curate-ahead).
    fireEvent.click(screen.getByRole("checkbox", { name: "Iberia" }));
    expect(d.lastDirector().regions).toEqual(["iberia"]);
  });

  it("shows the director mode as a read-only chip and links to the desk", () => {
    renderInDraft(<DirectorSettings />, { sceneId: "wind" });

    expect(screen.getByText("Off")).toBeInTheDocument();
    // No mode switch here — Auto/Off is a live control that stays on /control.
    expect(screen.queryByRole("checkbox", { name: /auto/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Control page" })).toHaveAttribute(
      "href",
      "/control?scene=wind",
    );
  });

  it("reads Auto when the director is driving", () => {
    renderInDraft(<DirectorSettings />, { config: { mode: "auto" } });
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("a playing script reads as such, and Stop switches the director off at once", async () => {
    const d = renderInDraft(<DirectorSettings />, { sceneId: "shorts-preview", config: { mode: "script" } });

    expect(screen.getByText("Playing a script")).toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    // A live action, not a staged edit: PATCHed now, nothing left for Save.
    expect(mockPatchDirector).toHaveBeenCalledWith("shorts-preview", { mode: "off" });
    expect(d.stagedDirector).toHaveLength(0);
    await waitFor(() => expect(screen.getByText("Off")).toBeInTheDocument());
    expect(screen.queryByText("Playing a script")).not.toBeInTheDocument();
  });

  it("keeps the script chip (and offers Stop again) when the stop fails", async () => {
    mockPatchDirector.mockRejectedValueOnce(new Error("nope"));
    renderInDraft(<DirectorSettings />, { config: { mode: "script" } });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled());
    expect(screen.getByText("Playing a script")).toBeInTheDocument();
  });

  it("a preset chip stages the preset's content bundle", () => {
    const d = renderInDraft(<DirectorSettings />);
    const preset = DIRECTOR_PRESETS.find((p) => p.id === "storms-only")!;

    fireEvent.click(screen.getByText(preset.name));

    expect(d.lastDirector()).toEqual(preset.patch);
  });

  it("changing a kind's frequency stages the full weights map", () => {
    const d = renderInDraft(<DirectorSettings />);

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Severe storms frequency" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Often · ×2"));

    expect(d.lastDirector()).toEqual({ kindWeights: { storm: 2 } });
  });

  it("reads its own staged edit back out of the draft", () => {
    renderInDraft(<DirectorSettings />);

    const france = screen.getByRole("checkbox", { name: "🇫🇷 France" });
    fireEvent.click(france);

    // No local copy in the card — the tick survives because the draft holds it.
    expect(screen.getByRole("checkbox", { name: "🇫🇷 France" })).toBeChecked();
  });
});
