/**
 * DirectorTemplateBar — Apply template (with a confirm naming what it replaces)
 * and Copy from channel (everything but the live controls). Both stage into the
 * draft; neither saves.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig } from "@photonsurge/shared/director";
import { DIRECTOR_TEMPLATES, templatePatch } from "@photonsurge/shared/director-templates";
import DirectorTemplateBar from "./DirectorTemplateBar";
import { renderInDraft } from "./draft-harness";

jest.mock("../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "main", name: "Main" },
    { id: "wind", name: "Wind channel" },
    { id: "ocean-tv", name: "Ocean TV" },
  ]),
}));

const loadDirectorConfig = jest.fn();
jest.mock("../../../lib/director", () => ({
  ...jest.requireActual("../../../lib/director"),
  loadDirectorConfig: (id: string) => loadDirectorConfig(id),
}));

beforeEach(() => loadDirectorConfig.mockReset());

const pickTemplate = (label: string) => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Apply template" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
};

describe("DirectorTemplateBar — templates", () => {
  it("offers every template", () => {
    renderInDraft(<DirectorTemplateBar />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Apply template" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Full feed", "Maps", "Events", "Ocean"]);
  });

  it("confirms with what it replaces, then stages the template", () => {
    const d = renderInDraft(<DirectorTemplateBar />);
    pickTemplate("Maps");
    const dialog = screen.getByRole("dialog", { name: "Apply “Maps”?" });
    const replaced = within(within(dialog).getByRole("list", { name: "Replaced settings" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(replaced).toEqual(expect.arrayContaining(["Which slide types air", "Hold times", "Map tempo"]));
    expect(replaced).not.toContain("Event pools");
    expect(d.stagedDirector).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(d.lastDirector()).toEqual(templatePatch("maps"));
    expect(d.lastDirector()).not.toHaveProperty("breakIn");
    expect(d.lastDirector()).not.toHaveProperty("kindLooks");
  });

  it("stages nothing on cancel", async () => {
    const d = renderInDraft(<DirectorTemplateBar />);
    pickTemplate("Events");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(d.stagedDirector).toHaveLength(0);
  });

  it("says so when the channel already matches, with Apply disabled", () => {
    renderInDraft(<DirectorTemplateBar />, { config: DIRECTOR_TEMPLATES.full.config });
    pickTemplate("Full feed");
    expect(screen.getByText(/already matches it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});

describe("DirectorTemplateBar — copy from channel", () => {
  const open = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy from channel…" }));
    const channel = await screen.findByRole("combobox", { name: "Channel" });
    await waitFor(() => expect(channel).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.mouseDown(channel);
  };

  it("lists the other channels, not this one", async () => {
    renderInDraft(<DirectorTemplateBar />, { sceneId: "wind" });
    await open();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Main", "Ocean TV"]);
  });

  it("stages the source's setup minus its live controls", async () => {
    const source = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { mode: "auto", skipNonce: 4, minQuakeMag: 6.5, activeSlideId: { quake: "x" } });
    loadDirectorConfig.mockResolvedValue(source);
    const d = renderInDraft(<DirectorTemplateBar />, { sceneId: "wind" });
    await open();
    fireEvent.click(screen.getByRole("option", { name: "Ocean TV" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(loadDirectorConfig).toHaveBeenCalledWith("ocean-tv");
    const staged = d.lastDirector();
    expect(staged.minQuakeMag).toBe(6.5);
    expect(staged.breakIn).toEqual(source.breakIn);
    for (const k of ["mode", "skipNonce", "activeSlideId"]) expect(staged).not.toHaveProperty(k);
  });

  it("stages nothing and says so when the source can't be read", async () => {
    loadDirectorConfig.mockResolvedValue(null);
    const d = renderInDraft(<DirectorTemplateBar />, { sceneId: "wind" });
    await open();
    fireEvent.click(screen.getByRole("option", { name: "Main" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/);
    expect(d.stagedDirector).toHaveLength(0);
  });

  it("keeps Copy disabled until a channel is picked", async () => {
    renderInDraft(<DirectorTemplateBar />);
    fireEvent.click(screen.getByRole("button", { name: "Copy from channel…" }));
    expect(await screen.findByRole("button", { name: "Copy" })).toBeDisabled();
  });
});
