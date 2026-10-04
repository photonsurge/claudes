import mongoose from "mongoose";
import {
  CROSSWORD_PUZZLE_STATUSES,
  CROSSWORD_THEME_PRESETS,
  DEFAULT_CROSSWORD_CONFIG,
  DEFAULT_CROSSWORD_THEME,
  chooseNextPuzzle,
  crosswordThemeVars,
  emptyGame,
  mergeCrosswordConfig,
  numberEntries,
  revealEntry,
  toPublicState,
  validateClue,
  type CrosswordGame,
  type CrosswordPuzzle,
  type CrosswordTheme,
} from "./crossword";
import { CROSSWORD_SEED_WORDS } from "./crossword-seeds";
import { getCrosswordPuzzleModel } from "./db/crossword-puzzle-model";
import { getCrosswordConfigModel } from "./db/crossword-config-model";

/**
 * Written from docs/crossword-mode-plan.md §4.1, §5.1, §7.3 (seed set), §7.4
 * and §9, not from the code: entries name the bank word and clue they came
 * from, puzzles are ready or rejected and carry familyFriendly, the theme has
 * one preset and becomes CSS variables, and nothing of that leaks on the wire.
 */

const conn = mongoose.createConnection();
afterAll(async () => {
  await conn.destroy().catch(() => undefined);
});
const strip = (o: Record<string, unknown>) => {
  const { _id, __v, created, updated, ...rest } = o;
  return rest;
};

const entries = numberEntries([
  { answer: "CRATER", clue: "Bowl left by an impact", row: 0, col: 0, dir: "across", wordId: "w-crater", clueId: "c-crater" },
  { answer: "COMET", clue: "Icy visitor with a glowing tail", row: 0, col: 0, dir: "down", wordId: "w-comet", clueId: "c-comet" },
  { answer: "TIDES", clue: "Daily rise and fall of the sea", row: 0, col: 4, dir: "down", wordId: "w-tides", clueId: "c-tides" },
]);

const puzzle = (over: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle => ({
  id: "p1",
  title: "Puzzle 1",
  width: 6,
  height: 5,
  entries,
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 100,
  plays: [],
  ...over,
});

describe("entries carry the bank word and clue they came from (§4.1)", () => {
  it("numbering keeps wordId and clueId on every entry", () => {
    const byAnswer = Object.fromEntries(entries.map((e) => [e.answer, e]));
    expect(byAnswer.CRATER).toMatchObject({ id: "1A", wordId: "w-crater", clueId: "c-crater" });
    expect(byAnswer.COMET).toMatchObject({ id: "1D", wordId: "w-comet", clueId: "c-comet" });
    expect(byAnswer.TIDES).toMatchObject({ wordId: "w-tides", clueId: "c-tides" });
  });

  it("the stored puzzle keeps wordId, clueId and familyFriendly (strict schema)", () => {
    const M = getCrosswordPuzzleModel(conn);
    const p = puzzle();
    const back = strip(new M(p).toObject({ versionKey: false })) as unknown as CrosswordPuzzle;
    expect(back.familyFriendly).toBe(true);
    expect(back.entries.map((e) => [e.wordId, e.clueId])).toEqual(entries.map((e) => [e.wordId, e.clueId]));
    expect(back).toEqual(p);
  });
});

describe("puzzles are ready or rejected (§4.1, §7.4)", () => {
  it("there is no draft status", () => {
    expect([...CROSSWORD_PUZZLE_STATUSES].sort()).toEqual(["ready", "rejected"]);
  });

  it("the schema accepts ready and rejected only", () => {
    const M = getCrosswordPuzzleModel(conn);
    expect(new M(puzzle({ status: "ready" })).validateSync()).toBeUndefined();
    expect(new M(puzzle({ status: "rejected" })).validateSync()).toBeUndefined();
    expect(new M({ ...puzzle(), status: "draft" }).validateSync()?.errors?.status).toBeDefined();
  });

  it("the schema has no theme or model field on a puzzle", () => {
    const M = getCrosswordPuzzleModel(conn);
    const doc = new M({ ...puzzle(), theme: "Volcanoes", model: "some-model" }).toObject();
    expect(doc).not.toHaveProperty("theme");
    expect(doc).not.toHaveProperty("model");
  });

  it("a stored puzzle without the flag is not family friendly", () => {
    const M = getCrosswordPuzzleModel(conn);
    const { familyFriendly: _ff, ...rest } = puzzle();
    expect(new M(rest).toObject().familyFriendly).toBe(false);
  });

  it("a rejected puzzle is never picked to play", () => {
    const r = puzzle({ id: "r", status: "rejected", createdAt: 1 });
    const ok = puzzle({ id: "ok", status: "ready", createdAt: 2 });
    expect(chooseNextPuzzle([r, ok], "xw", 30)?.id).toBe("ok");
    expect(chooseNextPuzzle([r], "xw", 30)).toBeNull();
  });
});

describe("the wire projection leaks nothing of the bank (§4.3)", () => {
  const game = (): Omit<CrosswordGame, "pub"> => {
    const { pub: _pub, ...g } = emptyGame("xw", 0);
    return { ...g, puzzleId: "p1", puzzleNo: 1, phase: "playing", phaseEndsAt: 1000 };
  };

  it("no answer, wordId or clueId appears anywhere in the payload", () => {
    const pub = toPublicState(puzzle(), game(), { now: 10 });
    const json = JSON.stringify(pub);
    for (const e of entries) {
      expect(json).not.toContain(e.answer);
      expect(json).not.toContain(e.wordId);
      expect(json).not.toContain(e.clueId);
    }
    expect(json).not.toMatch(/"answer"|"wordId"|"clueId"|"familyFriendly"/);
    for (const pe of pub.entries) expect(Object.keys(pe).sort()).toEqual(["clue", "col", "dir", "id", "length", "num", "row"]);
  });

  it("a solved entry shows its letters but still no ids", () => {
    const g = revealEntry({ ...game(), pub: undefined as never }, entries.find((e) => e.answer === "TIDES")!, 5);
    const { pub: _p, ...rest } = g;
    const pub = toPublicState(puzzle(), rest, { now: 10 });
    const json = JSON.stringify(pub);
    expect(json).not.toContain("w-tides");
    expect(json).not.toContain("c-tides");
    expect(json).not.toContain("CRATER");
    expect(pub.rows.map((r) => r[4]).join("")).toBe("TIDES");
  });
});

describe("config: theme and familyFriendlyOnly (§5.1, §7.4, §9)", () => {
  it("familyFriendlyOnly is on by default", () => {
    expect(DEFAULT_CROSSWORD_CONFIG.familyFriendlyOnly).toBe(true);
  });

  it("carries the theme", () => {
    expect(DEFAULT_CROSSWORD_CONFIG.theme).toEqual(DEFAULT_CROSSWORD_THEME);
  });

  it("has no autoApprove, themes or themeEvery", () => {
    for (const k of ["autoApprove", "themes", "themeEvery"]) expect(DEFAULT_CROSSWORD_CONFIG).not.toHaveProperty(k);
    const merged = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, {
      autoApprove: true,
      themes: ["x"],
      themeEvery: 3,
    } as never);
    for (const k of ["autoApprove", "themes", "themeEvery"]) expect(merged).not.toHaveProperty(k);
  });

  it("familyFriendlyOnly can be switched off and back on", () => {
    const off = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, { familyFriendlyOnly: false });
    expect(off.familyFriendlyOnly).toBe(false);
    expect(mergeCrosswordConfig(off, { familyFriendlyOnly: true }).familyFriendlyOnly).toBe(true);
    expect(mergeCrosswordConfig(off, { familyFriendlyOnly: "yes" as never }).familyFriendlyOnly).toBe(false);
  });

  it("the stored config defaults familyFriendlyOnly on and keeps the theme (strict schema)", () => {
    const M = getCrosswordConfigModel(conn);
    expect(new M({ id: "xw" }).toObject().familyFriendlyOnly).toBe(true);
    const theme: CrosswordTheme = {
      ...DEFAULT_CROSSWORD_THEME,
      brand: { title: "Daily Words", logoUrl: "/logo.png" },
      colors: { ...DEFAULT_CROSSWORD_THEME.colors, accent: "#ff0000" },
    };
    const doc = new M({ id: "xw", theme, familyFriendlyOnly: false }).toObject();
    expect(doc.theme).toEqual(theme);
    expect(doc.familyFriendlyOnly).toBe(false);
  });

  it("a theme patch on the config changes the brand", () => {
    const next = mergeCrosswordConfig(DEFAULT_CROSSWORD_CONFIG, {
      theme: { ...DEFAULT_CROSSWORD_THEME, brand: { title: "Daily Words", logoUrl: "" } },
    });
    expect(next.theme.brand.title).toBe("Daily Words");
  });
});

describe("CrosswordTheme (§5.1)", () => {
  const COLOR_KEYS = ["background", "panel", "cell", "cellSolved", "block", "ink", "inkMuted", "accent"] as const;

  it("has the plan's shape", () => {
    const t = DEFAULT_CROSSWORD_THEME;
    expect(typeof t.preset).toBe("string");
    expect(Object.keys(t.brand).sort()).toEqual(["logoUrl", "title"]);
    expect(Object.keys(t.colors).sort()).toEqual([...COLOR_KEYS].sort());
    expect(Object.keys(t.font).sort()).toEqual(["display", "text"]);
  });

  it("there is exactly one preset, and the default is it", () => {
    expect(CROSSWORD_THEME_PRESETS).toHaveLength(1);
    const p = CROSSWORD_THEME_PRESETS[0];
    expect(DEFAULT_CROSSWORD_THEME.preset).toBe(p.id);
    expect(DEFAULT_CROSSWORD_THEME.colors).toEqual(p.colors);
    expect(DEFAULT_CROSSWORD_THEME.font).toEqual(p.font);
  });

  it("the preset is the prototype's look: a light board, dark blocks, dark ink", () => {
    const lum = (hex: string) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) throw new Error(`not #rrggbb: ${hex}`);
      const n = parseInt(m[1], 16);
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    };
    const c = DEFAULT_CROSSWORD_THEME.colors;
    expect(lum(c.background)).toBeGreaterThan(0.8);
    expect(lum(c.cell)).toBeGreaterThan(0.8);
    expect(lum(c.block)).toBeLessThan(0.25);
    expect(lum(c.ink)).toBeLessThan(0.25);
  });

  it("turns into CSS variables: one per colour and font, holding the theme's values", () => {
    const vars = crosswordThemeVars(DEFAULT_CROSSWORD_THEME);
    const keys = Object.keys(vars);
    expect(keys.length).toBe(COLOR_KEYS.length + 2);
    for (const k of keys) expect(k).toMatch(/^--[a-z][a-z0-9-]*$/);
    const values = Object.values(vars);
    for (const k of COLOR_KEYS) expect(values).toContain(DEFAULT_CROSSWORD_THEME.colors[k]);
    expect(values).toContain(DEFAULT_CROSSWORD_THEME.font.display);
    expect(values).toContain(DEFAULT_CROSSWORD_THEME.font.text);
  });

  it("a different colour changes exactly one variable (a new look is a new preset, not a rewrite)", () => {
    const a = crosswordThemeVars(DEFAULT_CROSSWORD_THEME);
    const b = crosswordThemeVars({ ...DEFAULT_CROSSWORD_THEME, colors: { ...DEFAULT_CROSSWORD_THEME.colors, accent: "#123456" } });
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
    expect(changed).toHaveLength(1);
    expect(b[changed[0]]).toBe("#123456");
  });

  it("a hostile value never reaches a CSS variable", () => {
    const vars = crosswordThemeVars({
      ...DEFAULT_CROSSWORD_THEME,
      colors: { ...DEFAULT_CROSSWORD_THEME.colors, accent: "red;}body{background:url(http://x)" },
      font: { display: "x;}</style><script>", text: DEFAULT_CROSSWORD_THEME.font.text },
    });
    for (const v of Object.values(vars)) expect(v).not.toMatch(/[;{}<>]|url\(/);
  });
});

describe("the seed set (§7.3)", () => {
  it("is approved and family friendly, words and clues alike", () => {
    expect(CROSSWORD_SEED_WORDS.length).toBeGreaterThan(0);
    for (const w of CROSSWORD_SEED_WORDS) {
      expect(w.approved).toBe(true);
      expect(w.familyFriendly).toBe(true);
    }
  });

  it("every seed word carries a word id and a clue id for the puzzle entry", () => {
    const ids = new Set<string>();
    const clueIds = new Set<string>();
    for (const w of CROSSWORD_SEED_WORDS) {
      expect(w.id).toBeTruthy();
      expect(w.clueId).toBeTruthy();
      ids.add(w.id);
      clueIds.add(w.clueId);
    }
    expect(ids.size).toBe(CROSSWORD_SEED_WORDS.length);
    expect(clueIds.size).toBe(CROSSWORD_SEED_WORDS.length);
  });

  it("every seed answer is A–Z, 3–12 letters, and its clue passes validateClue", () => {
    for (const w of CROSSWORD_SEED_WORDS) {
      expect(w.answer).toMatch(/^[A-Z]{3,12}$/);
      expect([w.answer, validateClue(w.clue, w.answer)]).toEqual([w.answer, null]);
    }
  });
});
