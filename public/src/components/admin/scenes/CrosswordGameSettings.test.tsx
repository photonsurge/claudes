/**
 * The Game cards — a crossword channel's CrosswordConfig as five forms. They
 * stage into the crossword bucket only (never the channel or director ones),
 * clamp to CROSSWORD_CONFIG_LIMITS, and commit lists on blur.
 */
import { fireEvent, screen } from "@testing-library/react";
import { CROSSWORD_CONFIG_LIMITS } from "@photonsurge/shared/crossword";
import {
  CrosswordChatSettings,
  CrosswordDifficultySettings,
  CrosswordOnSettings,
  CrosswordPacingSettings,
  CrosswordPuzzleSettings,
  parseList,
} from "./CrosswordGameSettings";
import { renderInDraft } from "./draft-harness";

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Game cards", () => {
  it("stages the On switches into the crossword bucket only", () => {
    const d = renderInDraft(<CrosswordOnSettings />, { crossword: {} });
    fireEvent.click(screen.getByRole("switch", { name: "Host this channel" }));
    fireEvent.click(screen.getByRole("switch", { name: "Play off air" }));

    expect(d.stagedCrossword).toEqual([{ enabled: true }, { playOffAir: true }]);
    expect(d.staged).toEqual([]);
    expect(d.stagedDirector).toEqual([]);
  });

  it("stages a pacing number, clamped to the config limits", () => {
    const d = renderInDraft(<CrosswordPacingSettings />, { crossword: {} });
    type("Clue time", "45");
    expect(d.lastCrossword()).toEqual({ clueS: 45 });

    type("Clue time", "99999");
    expect(d.lastCrossword()).toEqual({ clueS: CROSSWORD_CONFIG_LIMITS.clueS[1] });

    type("Hints start at", "0.25");
    expect(d.lastCrossword()).toEqual({ hintStartFrac: 0.25 });
  });

  it("shows the channel's stored values", () => {
    renderInDraft(<CrosswordPacingSettings />, { crossword: { ceilingMin: 33 } });
    expect(screen.getByLabelText("Puzzle ceiling")).toHaveValue("33");
  });

  it("commits a theme list on blur, trimmed and de-duplicated", () => {
    const d = renderInDraft(<CrosswordDifficultySettings />, { crossword: {} });
    type("Themes", "weather, space\n weather \n\nearth");
    expect(d.lastCrossword()).toEqual({ themes: ["weather", "space", "earth"] });
  });

  it("never lets Most words drop below Fewest words", () => {
    const d = renderInDraft(<CrosswordPuzzleSettings />, { crossword: { minWords: 12, maxWords: 16 } });
    type("Most words", "5");
    expect(d.lastCrossword()).toEqual({ maxWords: 12 });
    fireEvent.click(screen.getByRole("switch", { name: "Auto-approve new puzzles" }));
    expect(d.lastCrossword()).toEqual({ autoApprove: true });
  });

  it("stages the chat limits and the blocklist", () => {
    const d = renderInDraft(<CrosswordChatSettings />, { crossword: {} });
    type("Stream delay", "4");
    type("Blocked words", "foo\nbar");
    expect(d.stagedCrossword).toEqual([{ streamDelayS: 4 }, { blocklist: ["foo", "bar"] }]);
  });

  it("parses a typed list", () => {
    expect(parseList(" a, b\nb ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseList("")).toEqual([]);
  });
});
