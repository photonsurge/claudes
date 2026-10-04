import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG, type KindSlide } from "@photonsurge/shared/director";
import { INTRO_MAP_TYPES } from "@photonsurge/shared/director-rois";
import DirectorLooksSettings from "./DirectorLooksSettings";
import { renderInDraft } from "./draft-harness";

const slide = (id: string, name: string): KindSlide =>
  ({ id, name, look: { basemap: "night" }, overlays: { showFaults: false } }) as KindSlide;

describe("DirectorLooksSettings", () => {
  it("unticking a look stores the explicit remaining list", () => {
    const d = renderInDraft(<DirectorLooksSettings />);
    const first = INTRO_MAP_TYPES[0];
    fireEvent.click(screen.getByRole("checkbox", { name: `Global spin: ${first.title}` }));
    expect(d.lastDirector()).toEqual({
      mapTypes: { ...DEFAULT_DIRECTOR_CONFIG.mapTypes, global: INTRO_MAP_TYPES.slice(1).map((t) => t.id) },
    });
  });

  it("re-ticking the last missing look goes back to 'all' (empty list)", () => {
    const rest = INTRO_MAP_TYPES.slice(1).map((t) => t.id);
    const d = renderInDraft(<DirectorLooksSettings />, { config: { mapTypes: { global: rest } } });
    fireEvent.click(screen.getByRole("checkbox", { name: `Global spin: ${INTRO_MAP_TYPES[0].title}` }));
    expect(d.lastDirector().mapTypes?.global).toEqual([]);
  });

  it("never unticks a kind's last look", () => {
    const only = [INTRO_MAP_TYPES[0].id];
    const d = renderInDraft(<DirectorLooksSettings />, { config: { mapTypes: { global: only } } });
    fireEvent.click(screen.getByRole("checkbox", { name: `Global spin: ${INTRO_MAP_TYPES[0].title}` }));
    expect(d.stagedDirector).toHaveLength(0);
  });

  it("hides the map looks of a kind the channel doesn't air", () => {
    renderInDraft(<DirectorLooksSettings />, { config: { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, quake: false } } });
    expect(screen.queryByRole("checkbox", { name: /^Earthquake terrain:/ })).not.toBeInTheDocument();
  });

  it("picking a saved look stages the look, its overlays and the active slide", () => {
    const d = renderInDraft(<DirectorLooksSettings />, { config: { kindSlides: { ship: [slide("s1", "Night sea")] } } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Ships" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Night sea"));
    expect(d.lastDirector()).toEqual({
      kindLooks: { ...DEFAULT_DIRECTOR_CONFIG.kindLooks, ship: { basemap: "night" } },
      overlayOverrides: { ...DEFAULT_DIRECTOR_CONFIG.overlayOverrides, ship: { showFaults: false } },
      activeSlideId: { ...DEFAULT_DIRECTOR_CONFIG.activeSlideId, ship: "s1" },
    });
  });

  it("going back to the default look clears the kind's look", () => {
    const d = renderInDraft(<DirectorLooksSettings />, {
      config: { kindSlides: { ship: [slide("s1", "Night sea")] }, activeSlideId: { ship: "s1" } },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Ships" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Default look"));
    expect(d.lastDirector().kindLooks?.ship).toEqual({});
    expect(d.lastDirector().activeSlideId?.ship).toBeNull();
  });

  it("deletes the selected saved look and clears it as active", () => {
    const d = renderInDraft(<DirectorLooksSettings />, {
      config: { kindSlides: { ship: [slide("s1", "Night sea"), slide("s2", "Day")] }, activeSlideId: { ship: "s1" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete saved look Night sea for Ships" }));
    expect(d.lastDirector().kindSlides?.ship?.map((s) => s.id)).toEqual(["s2"]);
    expect(d.lastDirector().activeSlideId?.ship).toBeNull();
  });

  it("disables the picker for a kind with no saved looks", () => {
    renderInDraft(<DirectorLooksSettings />, { config: { kindSlides: {} } });
    expect(screen.getByRole("combobox", { name: "Ships" })).toHaveAttribute("aria-disabled", "true");
  });
});
