/**
 * Plan §8.2 / §10 / §12 — a crossword channel's settings page,
 * /admin/crosswords/channels/:id. Cards in three groups (Look, Game, YouTube),
 * one Save bar, nothing live until Save. Look and Game save to the crossword
 * config (PATCH /api/crossword/:scene/config); the music bed and the YouTube
 * cards (including which YouTube channel, `youtube.accountId`) save to the
 * channel record through the scene save path. An account that needs
 * reconnecting cannot be picked. Family friendly only defaults on.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";
import { DEFAULT_CROSSWORD_CONFIG, DEFAULT_CROSSWORD_THEME, type CrosswordConfig } from "@photonsurge/shared/crossword";
import ChannelSettingsPage from "./ChannelSettingsPage";

jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(),
  fetchSceneState: jest.fn(),
  patchScene: jest.fn(),
  emitScenePatch: jest.fn(),
}));
jest.mock("./client", () => ({
  fetchCrosswordConfig: jest.fn(),
  patchCrosswordConfig: jest.fn(),
  fetchYoutubeChannels: jest.fn(),
}));
import { emitScenePatch, fetchSceneState, listScenes, patchScene } from "../../../../lib/scenes";
import { fetchCrosswordConfig, fetchYoutubeChannels, patchCrosswordConfig } from "./client";

const THEME = {
  ...DEFAULT_CROSSWORD_THEME,
  brand: { title: "Puzzle Hour", logoUrl: "/images/ph.png" },
  colors: { ...DEFAULT_CROSSWORD_THEME.colors, background: "#102030", accent: "#ff8800" },
};
const CONFIG: CrosswordConfig = { ...DEFAULT_CROSSWORD_CONFIG, theme: THEME };
const RECORD: ControlState = {
  ...DEFAULT_CONTROL_STATE,
  youtube: { ...DEFAULT_CONTROL_STATE.youtube, accountId: "", title: "", description: "", thumbnailUrl: "" },
};

beforeEach(() => {
  jest.clearAllMocks();
  (listScenes as jest.Mock).mockResolvedValue([{ id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" }]);
  (fetchSceneState as jest.Mock).mockResolvedValue({ state: RECORD, tokenError: false });
  (patchScene as jest.Mock).mockResolvedValue({ ok: true });
  (fetchCrosswordConfig as jest.Mock).mockResolvedValue(CONFIG);
  (patchCrosswordConfig as jest.Mock).mockImplementation(async (_id: string, p: Partial<CrosswordConfig>) => ({ ...CONFIG, ...p }));
  (fetchYoutubeChannels as jest.Mock).mockResolvedValue([
    { id: "UCpuzzle", title: "Puzzle Hour Live", needsReconnect: false },
    { id: "UCstale", title: "Stale Channel", needsReconnect: true },
  ]);
  window.history.replaceState(null, "", "/admin/crosswords/channels/puzzle-hour");
});

const openGroup = (label: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
const ready = () => screen.findByLabelText("Brand title");

/** Commit a bounded number field (they commit on blur). */
function setNumber(label: RegExp, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

async function pickAccount(name: RegExp) {
  const pick = await screen.findByRole("combobox", { name: /goes out on|youtube channel/i });
  await waitFor(() => expect(pick).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.mouseDown(pick);
  const list = within(await screen.findByRole("listbox"));
  fireEvent.click(list.getByRole("option", { name }));
}

const nothingWritten = () => {
  expect(patchCrosswordConfig).not.toHaveBeenCalled();
  expect(patchScene).not.toHaveBeenCalled();
  expect(emitScenePatch).not.toHaveBeenCalled();
};

describe("layout", () => {
  it("has the Look, Game and YouTube groups and opens on Look", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    const rail = screen.getByRole("navigation", { name: "Settings groups" });
    for (const g of ["Look", "Game", "YouTube"]) expect(within(rail).getByRole("button", { name: new RegExp(`^${g}`) })).toBeInTheDocument();
    expect(within(rail).getAllByRole("button")).toHaveLength(3);
    expect(fetchCrosswordConfig).toHaveBeenCalledWith("puzzle-hour");
    expect(fetchSceneState).toHaveBeenCalledWith("puzzle-hour");
  });

  it("links the Desk and the /crossword output, never a /watch page", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/admin/crosswords/desk/puzzle-hour");
    expect(hrefs).toContain("/crossword/puzzle-hour");
    expect(hrefs.filter((h) => h?.startsWith("/watch"))).toEqual([]);
  });
});

describe("Look", () => {
  it("shows the stored brand title and logo", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    expect(await ready()).toHaveValue("Puzzle Hour");
    expect(screen.getByLabelText(/^Logo/)).toHaveValue("/images/ph.png");
  });

  it("previews from the theme: its colours as --cw-* variables, the brand title and logo, live as you type", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    const preview = screen.getByTestId("theme-preview");
    expect(preview.style.getPropertyValue("--cw-background")).toBe("#102030");
    expect(preview.style.getPropertyValue("--cw-accent")).toBe("#ff8800");
    expect(preview).toHaveTextContent("Puzzle Hour");
    expect(within(preview).getByRole("img")).toHaveAttribute("src", "/images/ph.png");

    fireEvent.change(screen.getByLabelText("Brand title"), { target: { value: "Cryptic Nights" } });
    expect(preview).toHaveTextContent("Cryptic Nights");
    fireEvent.change(screen.getByLabelText(/^Logo/), { target: { value: "" } });
    expect(within(preview).queryByRole("img")).not.toBeInTheDocument();
    nothingWritten();
  });

  it("carries the music bed", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    expect(screen.getByRole("checkbox", { name: "Music" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /mode/i })).toBeInTheDocument();
  });
});

describe("Game", () => {
  it("has pacing, difficulty, puzzles, chat and scoring, On and Play off air", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("Game");
    // Pacing: clue time, hints, intro and finale, the ceiling.
    expect(await screen.findByLabelText(/clue time/i)).toHaveValue(String(CONFIG.clueS));
    expect(screen.getAllByLabelText(/hint/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/intro/i)).toHaveValue(String(CONFIG.introS));
    expect(screen.getByLabelText(/finale/i)).toHaveValue(String(CONFIG.finaleS));
    expect(screen.getByLabelText(/ceiling/i)).toHaveValue(String(CONFIG.ceilingMin));
    // Difficulty: minZipf.
    expect(screen.getByLabelText(/frequency|zipf/i)).toHaveValue(String(CONFIG.minZipf));
    // Puzzles: stock target, no-repeat window, family friendly only.
    expect(screen.getByLabelText(/stock target/i)).toHaveValue(String(CONFIG.stockTarget));
    expect(screen.getByLabelText(/puzzle not replayed|no.repeat|repeat/i)).toHaveValue(String(CONFIG.noRepeatPuzzles));
    expect(screen.getByLabelText(/family friendly only/i, { selector: "input" })).toBeInTheDocument();
    // Chat and scoring: stream delay, rate limit.
    expect(screen.getByLabelText(/stream delay/i)).toHaveValue(String(CONFIG.streamDelayS));
    expect(screen.getByLabelText(/guesses|rate/i)).toHaveValue(String(CONFIG.rateMax));
    // The On switch with Play off air.
    expect(screen.getByLabelText(/^(on|host this channel|enabled)$/i, { selector: "input" })).not.toBeChecked();
    expect(screen.getByLabelText(/play off air/i, { selector: "input" })).not.toBeChecked();
  });

  it("defaults Family friendly only to on", async () => {
    expect(DEFAULT_CROSSWORD_CONFIG.familyFriendlyOnly).toBe(true);
    (fetchCrosswordConfig as jest.Mock).mockResolvedValue(DEFAULT_CROSSWORD_CONFIG);
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("Game");
    expect(await screen.findByLabelText(/family friendly only/i, { selector: "input" })).toBeChecked();
  });
});

describe("YouTube", () => {
  it("picks from the connected accounts; one needing reconnection can't be picked", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("YouTube");
    const pick = await screen.findByRole("combobox", { name: /goes out on|youtube channel/i });
    await waitFor(() => expect(pick).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.mouseDown(pick);
    const list = within(await screen.findByRole("listbox"));
    expect(list.getByRole("option", { name: /Puzzle Hour Live/ })).not.toHaveAttribute("aria-disabled", "true");
    const stale = list.getByRole("option", { name: /Stale Channel/ });
    expect(stale).toHaveAttribute("aria-disabled", "true");
    expect(stale).toHaveTextContent(/reconnect/i);
  });

  it("shows the stored channel as chosen", async () => {
    (fetchSceneState as jest.Mock).mockResolvedValue({
      state: { ...RECORD, youtube: { ...RECORD.youtube, accountId: "UCpuzzle" } },
      tokenError: false,
    });
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("YouTube");
    const pick = await screen.findByRole("combobox", { name: /goes out on|youtube channel/i });
    await waitFor(() => expect(pick).toHaveTextContent("Puzzle Hour Live"));
  });

  it("has the title, description and thumbnail", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("YouTube");
    expect(await screen.findByRole("textbox", { name: /title/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /description/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /thumbnail/i })).toBeInTheDocument();
  });
});

describe("one Save bar", () => {
  it("writes nothing until Save, across all three groups", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    fireEvent.change(await ready(), { target: { value: "Cryptic Nights" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Music" }));
    openGroup("Game");
    await screen.findByLabelText(/clue time/i);
    setNumber(/clue time/i, "75");
    fireEvent.click(screen.getByLabelText(/family friendly only/i, { selector: "input" }));
    openGroup("YouTube");
    await pickAccount(/Puzzle Hour Live/);
    fireEvent.change(screen.getByRole("textbox", { name: /title/i }), { target: { value: "Crossword live %d/%m" } });
    expect(screen.getByRole("button", { name: /^save/i })).toBeInTheDocument();
    nothingWritten();
  }, 20000);

  it("Save writes Look and Game to the config, music bed and YouTube to the channel record", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    fireEvent.change(await ready(), { target: { value: "Cryptic Nights" } });
    const musicWas = (screen.getByRole("checkbox", { name: "Music" }) as HTMLInputElement).checked;
    fireEvent.click(screen.getByRole("checkbox", { name: "Music" }));

    openGroup("Game");
    await screen.findByLabelText(/clue time/i);
    setNumber(/clue time/i, "75");
    setNumber(/frequency|zipf/i, "4");
    setNumber(/stream delay/i, "20");
    fireEvent.click(screen.getByLabelText(/family friendly only/i, { selector: "input" }));
    fireEvent.click(screen.getByLabelText(/^(on|host this channel|enabled)$/i, { selector: "input" }));
    fireEvent.click(screen.getByLabelText(/play off air/i, { selector: "input" }));

    openGroup("YouTube");
    await pickAccount(/Puzzle Hour Live/);
    fireEvent.change(screen.getByRole("textbox", { name: /title/i }), { target: { value: "Crossword live %d/%m" } });
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), { target: { value: "Solve along in chat." } });
    fireEvent.change(screen.getByRole("textbox", { name: /thumbnail/i }), { target: { value: "/images/xw-thumb.png" } });

    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    await waitFor(() => expect(patchCrosswordConfig).toHaveBeenCalledTimes(1));
    const [cfgScene, cfg] = (patchCrosswordConfig as jest.Mock).mock.calls[0];
    expect(cfgScene).toBe("puzzle-hour");
    expect(cfg.theme.brand.title).toBe("Cryptic Nights");
    expect(cfg.theme.brand.logoUrl).toBe("/images/ph.png");
    expect(cfg.theme.colors.background).toBe("#102030");
    expect(cfg).toMatchObject({ clueS: 75, minZipf: 4, streamDelayS: 20, familyFriendlyOnly: false, enabled: true, playOffAir: true });
    expect(cfg).not.toHaveProperty("audio");
    expect(cfg).not.toHaveProperty("youtube");

    await waitFor(() => expect(patchScene).toHaveBeenCalledTimes(1));
    const [recScene, rec] = (patchScene as jest.Mock).mock.calls[0];
    expect(recScene).toBe("puzzle-hour");
    expect(rec.audio.enabled).toBe(!musicWas);
    expect(rec.youtube).toMatchObject({
      accountId: "UCpuzzle",
      title: "Crossword live %d/%m",
      description: "Solve along in chat.",
      thumbnailUrl: "/images/xw-thumb.png",
    });
    for (const k of ["theme", "clueS", "minZipf", "familyFriendlyOnly", "enabled", "playOffAir"]) {
      expect(rec).not.toHaveProperty(k);
    }
    // The scene save path also pushes the delta live.
    // (no socket provider in the test, so the socket argument is null).
    const [, emitScene, emitted] = (emitScenePatch as jest.Mock).mock.calls[0];
    expect(emitScene).toBe("puzzle-hour");
    expect(emitted.youtube.accountId).toBe("UCpuzzle");

    await waitFor(() => expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument());
  }, 20000);

  it("writes only the document that changed", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    fireEvent.change(await ready(), { target: { value: "Only Look" } });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await waitFor(() => expect(patchCrosswordConfig).toHaveBeenCalledTimes(1));
    expect(patchScene).not.toHaveBeenCalled();
    expect(emitScenePatch).not.toHaveBeenCalled();
  });

  it("saves only the YouTube channel pick to the channel record", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    openGroup("YouTube");
    await pickAccount(/Puzzle Hour Live/);
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await waitFor(() => expect(patchScene).toHaveBeenCalledTimes(1));
    expect((patchScene as jest.Mock).mock.calls[0][1].youtube.accountId).toBe("UCpuzzle");
    expect(patchCrosswordConfig).not.toHaveBeenCalled();
  });

  it("Discard drops the staged edits and writes nothing", async () => {
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    fireEvent.change(await ready(), { target: { value: "Throwaway" } });
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.getByLabelText("Brand title")).toHaveValue("Puzzle Hour");
    expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
    nothingWritten();
  });

  it("keeps the draft and says so when the channel record write fails", async () => {
    (patchScene as jest.Mock).mockResolvedValue({ ok: false, error: "record refused" });
    render(<ChannelSettingsPage sceneId="puzzle-hour" />);
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Music" }));
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    expect(await screen.findByText(/record refused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save/i })).toBeInTheDocument();
  });
});
