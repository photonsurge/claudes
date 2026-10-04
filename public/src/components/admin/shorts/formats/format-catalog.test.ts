/**
 * The format editor's own card list (§5.5): grouped exactly as the plan's
 * table, every staged field owned by one card, and every field real on the
 * document its bucket names.
 */
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import { SETTINGS_CARDS, cardsForStagedKeys, cardsInGroup } from "../../scenes/catalog";
import { FORMAT_CARDS, FORMAT_GROUPS } from "./format-catalog";

const titles = (group: Parameters<typeof cardsInGroup>[0]) => cardsInGroup(group, FORMAT_CARDS).map((c) => c.title);

describe("format catalog", () => {
  it("groups the cards as §5.5's table does", () => {
    expect(FORMAT_GROUPS.map((g) => g.label)).toEqual(["Video", "Layout", "Presentation", "Identity"]);
    expect(titles("video")).toEqual(["Template", "Opener and close", "YouTube video", "Timing", "Render defaults"]);
    expect(titles("layout")).toEqual(["On-air widgets", "Report", "Deck slides", "Crawl"]);
    expect(titles("presentation")).toEqual(["Theme", "Camera", "Music bed", "Reading pace", "Looks and thresholds"]);
    expect(titles("identity")).toEqual(["About card"]);
  });

  it("gives every staged field exactly one owning card", () => {
    const seen = new Map<string, string>();
    for (const card of FORMAT_CARDS) {
      for (const field of card.fields) {
        const key = `${card.bucket}:${field}`;
        expect(seen.get(key) ?? card.id).toBe(card.id);
        seen.set(key, card.id);
      }
    }
  });

  it("only claims fields that exist on the documents they belong to", () => {
    const docs = { control: DEFAULT_CONTROL_STATE, director: DEFAULT_DIRECTOR_CONFIG, format: defaultShortFormat() };
    for (const card of FORMAT_CARDS) {
      for (const field of card.fields) expect(Object.prototype.hasOwnProperty.call(docs[card.bucket], field)).toBe(true);
    }
  });

  it("shares a channel card's fields exactly where it shares the component", () => {
    for (const card of FORMAT_CARDS.filter((c) => c.bucket === "control")) {
      const channel = SETTINGS_CARDS.find((c) => c.id === card.id);
      expect(channel?.fields).toEqual(card.fields);
    }
  });

  it("names the cards a staged format patch touches", () => {
    const changed = cardsForStagedKeys(["readPaceCps"], ["minQuakeMag"], ["video", "timing"], FORMAT_CARDS);
    expect(changed.map((c) => c.title)).toEqual(["YouTube video", "Timing", "Reading pace", "Looks and thresholds"]);
  });
});
