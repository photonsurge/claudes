/**
 * The settings catalog is the page's map: it decides what renders, where, and
 * which card owns which field. These tests pin the invariants the Save bar and
 * the rail depend on — above all that every staged key has exactly ONE owner,
 * so a change can always be named back to the operator.
 */
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import {
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  cardsForStagedKeys,
  cardsInGroup,
  getCard,
  groupOfCard,
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
        card.bucket === "director" ? DEFAULT_DIRECTOR_CONFIG : DEFAULT_CONTROL_STATE;
      for (const field of card.fields) {
        expect(Object.prototype.hasOwnProperty.call(doc, field)).toBe(true);
      }
    }
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

  it("resolves a deep-link anchor to its group", () => {
    expect(groupOfCard("youtube")).toBe("identity");
    expect(groupOfCard("director")).toBe("programme");
    expect(groupOfCard("nope")).toBeUndefined();
  });

  it("looks a card up by id", () => {
    expect(getCard("theme")?.title).toBe("Brand & theme");
    expect(getCard("nope")).toBeUndefined();
  });
});
