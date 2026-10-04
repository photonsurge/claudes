/**
 * The map of `/admin/crosswords/channels/:id`: its groups, its cards and which
 * field of which document each card stages. Read by the page (what to render),
 * the card shell (its title and unsaved mark) and the Save bar (naming what a
 * Save will change). `control` fields live on the channel record (the same
 * fields the weather cards use), `crossword` fields on the crossword config.
 */
export type ChannelGroupId = "look" | "game" | "youtube";
export type ChannelBucket = "control" | "crossword";

export type ChannelGroupDef = { id: ChannelGroupId; label: string; blurb: string };
export type ChannelCardDef = {
  id: string;
  title: string;
  group: ChannelGroupId;
  bucket: ChannelBucket;
  fields: readonly string[];
};

export const CHANNEL_GROUPS: readonly ChannelGroupDef[] = [
  { id: "look", label: "Look", blurb: "The channel's own brand and the music under the game." },
  { id: "game", label: "Game", blurb: "How the host runs the game: pacing, difficulty, puzzles, chat and scoring." },
  { id: "youtube", label: "YouTube", blurb: "Which YouTube channel it goes out on, and what each broadcast is created with." },
];

export const CHANNEL_CARDS: readonly ChannelCardDef[] = [
  { id: "brand", title: "Brand", group: "look", bucket: "crossword", fields: ["theme"] },
  { id: "music", title: "Music bed", group: "look", bucket: "control", fields: ["audio"] },
  { id: "pacing", title: "Pacing", group: "game", bucket: "crossword", fields: ["introS", "clueS", "finaleS", "revealHoldS", "solveBeatS", "ceilingMin", "hintStartFrac", "hintMaxFrac"] },
  { id: "difficulty", title: "Difficulty", group: "game", bucket: "crossword", fields: ["minZipf"] },
  { id: "puzzles", title: "Puzzles", group: "game", bucket: "crossword", fields: ["stockTarget", "noRepeatPuzzles", "noRepeatWordsPuzzles", "familyFriendlyOnly", "minWords", "maxWords", "maxSize"] },
  { id: "chat", title: "Chat and scoring", group: "game", bucket: "crossword", fields: ["streamDelayS", "rateMax", "rateWindowS", "blocklist"] },
  { id: "on", title: "On and off air", group: "game", bucket: "crossword", fields: ["enabled", "playOffAir"] },
  { id: "youtube-channel", title: "YouTube channel", group: "youtube", bucket: "control", fields: ["youtube.accountId"] },
  { id: "youtube-broadcast", title: "Broadcast title, description and thumbnail", group: "youtube", bucket: "control", fields: ["youtube.title", "youtube.description", "youtube.thumbnailUrl"] },
];

export const getChannelCard = (id: string) => CHANNEL_CARDS.find((c) => c.id === id);
export const cardsInChannelGroup = (g: ChannelGroupId) => CHANNEL_CARDS.filter((c) => c.group === g);

/**
 * The cards with staged edits. `youtube` is staged as the whole object, so its
 * cards are told apart by comparing against what the server has.
 */
export function changedCards(
  pending: { youtube?: object },
  pendingCrossword: object,
  savedYoutube: object,
): ChannelCardDef[] {
  const stagedYoutube = pending.youtube as Record<string, unknown> | undefined;
  const saved = savedYoutube as Record<string, unknown>;
  return CHANNEL_CARDS.filter((c) =>
    c.fields.some((f) => {
      if (f.startsWith("youtube.")) {
        const k = f.slice("youtube.".length);
        return !!stagedYoutube && stagedYoutube[k] !== saved[k];
      }
      return f in (c.bucket === "crossword" ? pendingCrossword : pending);
    }),
  );
}
