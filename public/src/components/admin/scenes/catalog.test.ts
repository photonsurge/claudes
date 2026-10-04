/**
 * The settings catalog is the page's map: it decides what renders, where, and
 * which card owns which field. These tests pin the invariants the Save bar and
 * the rail depend on — above all that every staged key has exactly ONE owner,
 * so a change can always be named back to the operator.
 */
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import {
  LIVE_ONLY_DIRECTOR_KEYS,
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  cardsForStagedKeys,
  cardsInGroup,
  getCard,
  groupOfCard,
  groupsForSurface,
} from "./catalog";

describe("settings catalog", () => {
  it("gives every card a unique id and a real group", () => {
    const ids = SETTINGS_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of SETTINGS_CARDS) {
      expect(SETTINGS_GROUPS.some((g) => g.id === card.group)).toBe(true);
    }
  });

  it("leaves no group empty", () => {
    for (const g of SETTINGS_GROUPS) {
      expect(cardsInGroup(g.id).length).toBeGreaterThan(0);
    }
  });

  it("gives every staged field exactly one owning card", () => {
    const seen = new Map<string, string>();
    for (const card of SETTINGS_CARDS) {
      for (const field of card.fields) {
        const key = `${card.bucket}:${field}`;
        const owner = seen.get(key);
        expect(owner ?? card.id).toBe(card.id);
        seen.set(key, card.id);
      }
    }
  });

  it("only claims fields that exist on the documents they belong to", () => {
    for (const card of SETTINGS_CARDS) {
      const doc: object =
        card.bucket === "director"
          ? DEFAULT_DIRECTOR_CONFIG
          : card.bucket === "crossword"
            ? DEFAULT_CROSSWORD_CONFIG
            : DEFAULT_CONTROL_STATE;
      for (const field of card.fields) {
        expect(Object.prototype.hasOwnProperty.call(doc, field)).toBe(true);
      }
    }
  });

  // Admin is the canonical home for a channel's director: every config key is
  // editable on some card, except the live desk controls.
  it("gives every DirectorConfig key an owning card, except the live-only ones", () => {
    const owned = new Set(SETTINGS_CARDS.filter((c) => c.bucket === "director").flatMap((c) => c.fields));
    const orphans = Object.keys(DEFAULT_DIRECTOR_CONFIG).filter(
      (k) => !owned.has(k) && !LIVE_ONLY_DIRECTOR_KEYS.includes(k),
    );
    expect(orphans).toEqual([]);
    for (const k of LIVE_ONLY_DIRECTOR_KEYS) expect(owned.has(k)).toBe(false);
  });

  it("gives every CrosswordConfig key an owning Game card", () => {
    const owned = new Set(SETTINGS_CARDS.filter((c) => c.bucket === "crossword").flatMap((c) => c.fields));
    expect(Object.keys(DEFAULT_CROSSWORD_CONFIG).filter((k) => !owned.has(k))).toEqual([]);
  });

  it("names the cards a set of staged keys belongs to, in page order", () => {
    const hit = cardsForStagedKeys(["audio", "widgetsOff"], []);
    expect(hit.map((c) => c.id)).toEqual(["widgets", "audio"]);
  });

  it("keeps the two buckets apart", () => {
    // `kinds` is a DirectorConfig key; a ControlState delta must not match it.
    expect(cardsForStagedKeys(["kinds"], [])).toEqual([]);
    expect(cardsForStagedKeys([], ["kinds"]).map((c) => c.id)).toEqual(["director"]);
  });

  it("keeps the crossword bucket apart from the other two", () => {
    // A Game key staged in another bucket names nothing.
    expect(cardsForStagedKeys([], [], ["clueS", "blocklist"]).map((c) => c.id)).toEqual([
      "crossword-pacing",
      "crossword-chat",
    ]);
    expect(cardsForStagedKeys(["clueS"], ["clueS"])).toEqual([]);
  });

  it("resolves a deep-link anchor to its group", () => {
    expect(groupOfCard("youtube")).toBe("identity");
    expect(groupOfCard("director")).toBe("programme");
    expect(groupOfCard("nope")).toBeUndefined();
  });

  it("looks a card up by id", () => {
    expect(getCard("theme")?.title).toBe("Brand & theme");
    expect(getCard("nope")).toBeUndefined();
  });

  describe("cards by type", () => {
    const ids = (surface: "globe" | "crossword") =>
      SETTINGS_GROUPS.flatMap((g) => cardsInGroup(g.id, surface)).map((c) => c.id);

    it("gives every card at least one kind of channel", () => {
      for (const card of SETTINGS_CARDS) expect(card.surfaces.length).toBeGreaterThan(0);
    });

    it("shows a weather channel no Game card", () => {
      const weather = ids("globe");
      expect(weather).toEqual(expect.arrayContaining(["widgets", "report", "deck", "crawl", "camera", "pace", "director"]));
      expect(weather.some((id) => id.startsWith("crossword-"))).toBe(false);
      expect(groupsForSurface("globe").map((g) => g.id)).toEqual(["layout", "presentation", "programme", "viewers", "identity"]);
    });

    it("shows a crossword channel the Game cards and the shared ones, nothing of the globe", () => {
      const xw = ids("crossword");
      expect(xw).toEqual([
        "crossword-on",
        "crossword-pacing",
        "crossword-difficulty",
        "crossword-puzzles",
        "crossword-chat",
        "theme",
        "audio",
        "chat",
        "about",
        "youtube",
      ]);
      expect(groupsForSurface("crossword").map((g) => g.id)).toEqual(["game", "presentation", "viewers", "identity"]);
    });

    it("lists every card of a group when no type is given", () => {
      expect(cardsInGroup("presentation").map((c) => c.id)).toEqual(["theme", "camera", "audio", "pace"]);
    });
  });
});
