/**
 * Plan §8.2 — the weather settings page (/admin/scenes/:id) is built for the
 * globe and is left alone: its catalog carries no crossword cards, no Game
 * group and no per-kind `surfaces` field, and it never touches the crossword
 * config. Opened for a crossword channel it sends the operator to
 * /admin/crosswords/channels/<id>.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { SETTINGS_CARDS, SETTINGS_GROUPS } from "../../../../components/admin/scenes/catalog";
import ChannelSettingsPage from "./page";

let mockParams = { id: "gusts" };
jest.mock("next/navigation", () => ({ useParams: () => mockParams }));
jest.mock("../../../../lib/channel-links", () => ({
  ...jest.requireActual("../../../../lib/channel-links"),
  replaceLocation: jest.fn(),
}));
jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "default", name: "Main" },
    { id: "gusts", name: "Gusts", surface: "globe" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" },
  ]),
  fetchSceneState: jest.fn(async () => ({ state: DEFAULT_CONTROL_STATE, tokenError: false })),
  patchScene: jest.fn(async () => ({ ok: true })),
  emitScenePatch: jest.fn(),
  useScenePatcher: () => jest.fn(),
}));
jest.mock("../../../../lib/director", () => ({
  fetchDirectorConfig: jest.fn(async () => DEFAULT_DIRECTOR_CONFIG),
  patchDirectorConfig: jest.fn(async () => ({})),
  mergeConfig: (a: object, b: object) => ({ ...a, ...b }),
}));
import { replaceLocation } from "../../../../lib/channel-links";

const realFetch = global.fetch;
beforeEach(() => {
  (replaceLocation as jest.Mock).mockClear();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  window.history.replaceState(null, "", "/admin/scenes/x");
});
afterEach(() => {
  global.fetch = realFetch;
});

const fetchedUrls = () => (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));

describe("the weather settings catalog is the weather one only", () => {
  it("has the weather groups and no Game or Look group", () => {
    const ids = SETTINGS_GROUPS.map((g) => g.id);
    expect(ids).toEqual(["layout", "presentation", "programme", "viewers", "identity"]);
    expect(SETTINGS_GROUPS.map((g) => g.label)).not.toEqual(expect.arrayContaining(["Game"]));
  });

  it("has no crossword cards and no per-kind surfaces field", () => {
    for (const card of SETTINGS_CARDS) {
      expect(card).not.toHaveProperty("surfaces");
      expect(card.id).not.toMatch(/crossword|^(pacing|difficulty|puzzles|on|game|brand|music)$/);
      expect(card.title).not.toMatch(/crossword|puzzle/i);
      for (const f of card.fields) {
        expect(["minZipf", "familyFriendlyOnly", "stockTarget", "streamDelayS", "playOffAir", "theme.brand"]).not.toContain(f);
      }
    }
    expect((SETTINGS_CARDS as readonly { bucket: string }[]).every((c) => c.bucket === "control" || c.bucket === "director")).toBe(true);
  });
});

describe("/admin/scenes/:id", () => {
  it("renders the weather page for a weather channel, with no redirect and no crossword config read", async () => {
    mockParams = { id: "gusts" };
    render(<ChannelSettingsPage />);
    expect(await screen.findByText("Channel: Gusts")).toBeInTheDocument();
    const rail = await screen.findByLabelText("Settings groups");
    for (const label of ["Layout", "Presentation", "Programme", "Viewers", "Identity"]) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
    expect(within(rail).queryByText("Game")).not.toBeInTheDocument();
    expect(within(rail).queryByText("Look")).not.toBeInTheDocument();
    // Give the draft time to load, then check nothing went to the crossword routes.
    await new Promise((r) => setTimeout(r, 50));
    expect(replaceLocation).not.toHaveBeenCalled();
    expect(fetchedUrls().filter((u) => u.includes("/api/crossword"))).toEqual([]);
  });

  it("keeps the weather page's Control and Watch links for a weather channel", async () => {
    mockParams = { id: "gusts" };
    render(<ChannelSettingsPage />);
    await screen.findByText("Channel: Gusts");
    expect(screen.getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control?scene=gusts");
    expect(screen.getByRole("link", { name: /Watch/ })).toHaveAttribute("href", "/watch/gusts");
  });

  it("sends a crossword channel to /admin/crosswords/channels/<id> and shows no weather cards", async () => {
    mockParams = { id: "puzzle-hour" };
    render(<ChannelSettingsPage />);
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/admin/crosswords/channels/puzzle-hour"));
    expect(replaceLocation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText("Settings groups")).not.toBeInTheDocument());
  });
});
