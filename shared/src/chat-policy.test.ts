import {
  BUILT_IN_PALETTES,
  DEFAULT_CHAT_COMMAND_SETTINGS,
  channelPalettes,
  mayCommand,
  mergeChatCommandSettings,
  parseChatCommand,
  requestedHoldS,
} from "./chat-policy";
import { AUDIO_MODES, DEFAULT_CONTROL_STATE, mergeControlState } from "./control";

const opts = { audioModes: AUDIO_MODES, sanitizeOverrides: (v: unknown) => (v && typeof v === "object" ? (v as Record<string, string>) : undefined) };
const merge = (patch: unknown) => mergeChatCommandSettings(DEFAULT_CHAT_COMMAND_SETTINGS, patch, opts);

describe("defaults", () => {
  it("leave every viewer power off", () => {
    expect(DEFAULT_CHAT_COMMAND_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_CHAT_COMMAND_SETTINGS.director.enabled).toBe(false);
    expect(DEFAULT_CHAT_COMMAND_SETTINGS.replyInChat).toBe(false);
    expect(DEFAULT_CHAT_COMMAND_SETTINGS.director.places.cities).toBe(false);
  });

  it("are what a fresh scene carries", () => {
    expect(DEFAULT_CONTROL_STATE.chat.commands).toEqual(DEFAULT_CHAT_COMMAND_SETTINGS);
  });
});

describe("mergeChatCommandSettings", () => {
  it("merges nested blocks field by field and drops unknown keys", () => {
    const out = merge({ enabled: true, music: { allowSkip: false }, bogus: 1, director: { ops: { skip: true } } });
    expect(out.enabled).toBe(true);
    expect(out.music).toEqual({ ...DEFAULT_CHAT_COMMAND_SETTINGS.music, allowSkip: false });
    expect(out.director.ops).toEqual({ ...DEFAULT_CHAT_COMMAND_SETTINGS.director.ops, skip: true });
    expect("bogus" in out).toBe(false);
  });

  it("keeps the hold under its maximum and both in range", () => {
    expect(merge({ music: { holdS: 5000, maxHoldS: 600 } }).music).toMatchObject({ holdS: 600, maxHoldS: 600 });
    expect(merge({ theme: { holdS: 1, maxHoldS: 1e9 } }).theme).toMatchObject({ holdS: 10, maxHoldS: 7200 });
  });

  it("only keeps real music modes", () => {
    expect(merge({ music: { allowed: ["deep", "polka", 3, "deep"] } }).music.allowed).toEqual(["deep"]);
  });

  it("rejects bad enums", () => {
    const out = merge({ allowFrom: "anyone", director: { mode: "whenever" } });
    expect(out.allowFrom).toBe("all");
    expect(out.director.mode).toBe("boundary");
  });

  it("cleans palettes: needs an id and a base, slugs the id, caps the list", () => {
    const out = merge({
      theme: {
        palettes: [
          { id: " Night Mode ", label: "Night", broadcastTheme: "storm", themeOverrides: { accent: "#f00" } },
          { id: "", broadcastTheme: "command" },
          { label: "no id" },
          ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, broadcastTheme: "aurora" })),
        ],
      },
    });
    expect(out.theme.palettes[0]).toEqual({ id: "night mode", label: "Night", broadcastTheme: "storm", themeOverrides: { accent: "#f00" } });
    expect(out.theme.palettes).toHaveLength(12);
  });

  it("merges director kinds key by key", () => {
    expect(merge({ director: { kinds: { flight: true, quake: false, nope: 3 } } }).director.kinds).toEqual({
      ...DEFAULT_CHAT_COMMAND_SETTINGS.director.kinds,
      flight: true,
      quake: false,
    });
  });

  it("is wired into mergeControlState, sanitising palette overrides with the real sanitiser", () => {
    const state = mergeControlState(DEFAULT_CONTROL_STATE, {
      chat: { enabled: true, promoteToTicker: false, commands: { theme: { palettes: [{ id: "x", broadcastTheme: "storm", themeOverrides: { accent: "#0f0", hack: "y" } }] } } } as never,
    });
    expect(state.chat.commands.theme.palettes[0].themeOverrides).toEqual({ accent: "#0f0" });
    // An old scene doc with no commands block gets the defaults.
    expect(mergeControlState(DEFAULT_CONTROL_STATE, { chat: { enabled: true, promoteToTicker: false } as never }).chat.commands).toEqual(
      DEFAULT_CHAT_COMMAND_SETTINGS,
    );
  });
});

describe("parseChatCommand", () => {
  it.each([
    [":music deep 10", { cmd: "music", args: ["deep"], minutes: 10 }],
    ["!theme storm", { cmd: "theme", args: ["storm"] }],
    [":SHOW New York", { cmd: "show", args: ["New", "York"] }],
    [":skip", { cmd: "skip", args: [] }],
    ["  :mode   aurora  5 ", { cmd: "mode", args: ["aurora"], minutes: 5 }],
  ])("%p", (text, out) => {
    expect(parseChatCommand(text)).toEqual(out);
  });

  it("ignores plain chatter and malformed commands", () => {
    expect(parseChatCommand("hello :music deep")).toBeNull();
    expect(parseChatCommand(":")).toBeNull();
    expect(parseChatCommand(":123")).toBeNull();
  });
});

describe("requestedHoldS / mayCommand / channelPalettes", () => {
  it("uses the default hold, or the viewer's minutes clamped to the max", () => {
    const slot = { holdS: 300, maxHoldS: 900 };
    expect(requestedHoldS(undefined, slot)).toBe(300);
    expect(requestedHoldS(0, slot)).toBe(300);
    expect(requestedHoldS(2, slot)).toBe(120);
    expect(requestedHoldS(60, slot)).toBe(900);
  });

  it("gates who may command", () => {
    const on = { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true };
    expect(mayCommand(DEFAULT_CHAT_COMMAND_SETTINGS, {})).toBe(false);
    expect(mayCommand(on, {})).toBe(true);
    expect(mayCommand({ ...on, allowFrom: "mods" }, {})).toBe(false);
    expect(mayCommand({ ...on, allowFrom: "mods" }, { isMod: true })).toBe(true);
    expect(mayCommand({ ...on, allowFrom: "mods" }, { isOwner: true })).toBe(true);
    expect(mayCommand({ ...on, allowFrom: "owner" }, { isMod: true })).toBe(false);
  });

  it("offers the channel's palettes, else the built-ins", () => {
    expect(channelPalettes(DEFAULT_CHAT_COMMAND_SETTINGS)).toBe(BUILT_IN_PALETTES);
    const own = { ...DEFAULT_CHAT_COMMAND_SETTINGS, theme: { ...DEFAULT_CHAT_COMMAND_SETTINGS.theme, palettes: [{ id: "a", label: "A", broadcastTheme: "storm" }] } };
    expect(channelPalettes(own).map((p) => p.id)).toEqual(["a"]);
  });
});
