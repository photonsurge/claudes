import { coalesceCommands, packReplies } from "./chat-coalesce";

const m = (author: string, text: string, extra: { isMod?: boolean; isOwner?: boolean } = {}) => ({ author, text, ...extra });

describe("coalesceCommands", () => {
  it("drops chatter and the info commands chat-commands.ts answers", () => {
    expect(coalesceCommands([m("a", "hello"), m("b", ":modes"), m("c", ":mode"), m("d", ":help")])).toEqual([]);
  });

  it("counts each viewer once — their last command", () => {
    const out = coalesceCommands([m("ann", ":music deep"), m("ann", ":music calm"), m("ANN", ":music storm")]);
    expect(out).toEqual([m("ANN", ":music storm")]);
  });

  it("votes per command word: most requested wins, a tie goes to the latest", () => {
    const votes = [m("a", ":music deep"), m("b", ":music calm"), m("c", ":music deep 10"), m("d", ":music calm")];
    // deep 2 (minutes ignored for the vote), calm 2 → calm asked last
    expect(coalesceCommands(votes)).toEqual([m("d", ":music calm")]);
    expect(coalesceCommands([...votes, m("e", ":music DEEP")])).toEqual([m("e", ":music DEEP")]);
  });

  it("a mod or owner's request overrides the vote", () => {
    const out = coalesceCommands([m("a", ":theme storm"), m("b", ":theme storm"), m("mod", ":theme aurora", { isMod: true }), m("c", ":theme storm")]);
    expect(out).toEqual([m("mod", ":theme aurora", { isMod: true })]);
  });

  it("keeps one winner per command, in message order", () => {
    const out = coalesceCommands([m("a", ":show japan"), m("b", ":music deep"), m("c", ":show japan"), m("d", ":skip"), m("e", ":skip")]);
    expect(out.map((x) => x.text)).toEqual([":music deep", ":show japan", ":skip"]);
  });
});

describe("packReplies", () => {
  it("joins short replies into one post", () => {
    expect(packReplies(["a", "b", "c"], 200, 2)).toEqual(["a · b · c"]);
  });

  it("starts a new post when the next part won't fit, up to the cap", () => {
    expect(packReplies(["aaaa", "bbbb", "cccc", "dddd"], 9, 2)).toEqual(["aaaa", "bbbb"]);
    expect(packReplies(["aa", "bb", "cccc"], 7, 2)).toEqual(["aa · bb", "cccc"]);
  });

  it("truncates a single over-long reply", () => {
    expect(packReplies(["x".repeat(10)], 5, 1)).toEqual(["xxxx…"]);
  });

  it("nothing to say → no posts", () => {
    expect(packReplies([], 200, 2)).toEqual([]);
  });
});
