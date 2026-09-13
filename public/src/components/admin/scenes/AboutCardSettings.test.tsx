/**
 * AboutCardSettings — the per-channel ABOUT card copy editor: title / body /
 * data sources / footnote, all shipped as ONE full about object per delta so
 * the draft's top-level spread-merge can't drop sibling fields.
 */
import { fireEvent, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import AboutCardSettings from "./AboutCardSettings";
import { renderInDraft } from "./draft-harness";

const about = (over: Partial<typeof DEFAULT_CONTROL_STATE.about> = {}) => ({
  ...DEFAULT_CONTROL_STATE.about,
  ...over,
});

describe("AboutCardSettings", () => {
  it("stages a title change with the FULL about object in the delta", () => {
    const d = renderInDraft(<AboutCardSettings />);
    fireEvent.change(screen.getByRole("textbox", { name: "About title" }), {
      target: { value: "About Storm Watch" },
    });

    expect(d.last()).toEqual({ about: about({ title: "About Storm Watch" }) });
  });

  it("stages the data-sources line without dropping existing copy", () => {
    const d = renderInDraft(<AboutCardSettings />, {
      state: { about: about({ title: "About Storm Watch", body: "Custom body." }) },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "About sources" }), {
      target: { value: "NOAA GFS, USGS" },
    });

    expect(d.last()).toEqual({
      about: about({ title: "About Storm Watch", body: "Custom body.", sources: "NOAA GFS, USGS" }),
    });
  });

  it("stages the footnote", () => {
    const d = renderInDraft(<AboutCardSettings />);
    fireEvent.change(screen.getByRole("textbox", { name: "About footnote" }), {
      target: { value: "Custom small print." },
    });

    expect(d.last()).toEqual({ about: about({ footer: "Custom small print." }) });
  });

  it("shows the channel's saved copy", () => {
    renderInDraft(<AboutCardSettings />, {
      state: { about: about({ body: "What this channel is.", sources: "NOAA GFS" }) },
    });

    expect(screen.getByDisplayValue("What this channel is.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("NOAA GFS")).toBeInTheDocument();
  });

  it("keeps successive edits on top of each other", () => {
    const d = renderInDraft(<AboutCardSettings />);
    fireEvent.change(screen.getByRole("textbox", { name: "About title" }), {
      target: { value: "Storm Watch" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "About footnote" }), {
      target: { value: "Small print." },
    });

    // The second delta is built from the merged draft, so it still carries the first.
    expect(d.last()).toEqual({ about: about({ title: "Storm Watch", footer: "Small print." }) });
  });
});
