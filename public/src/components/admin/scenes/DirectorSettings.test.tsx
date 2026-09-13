/**
 * DirectorSettings — the per-channel auto-director CONTENT card: which slide
 * types (kinds) air + their frequency, country/area favourites and one-click
 * presets. Everything stages COMPLETE top-level DirectorConfig fields into the
 * page's draft, so the shallow-merging Save can't drop a sibling.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { DIRECTOR_PRESETS } from "@photonsurge/shared/director-presets";
import DirectorSettings from "./DirectorSettings";
import { renderInDraft } from "./draft-harness";

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
