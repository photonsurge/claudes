import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_CHAT_COMMAND_SETTINGS } from "@photonsurge/shared/chat-policy";
import ChatCommandsSettings from "./ChatCommandsSettings";
import { renderInDraft } from "./draft-harness";

const on = (over: Record<string, unknown> = {}) => ({
  chat: { enabled: true, promoteToTicker: false, commands: { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true, ...over } },
});
const lastChat = (d: ReturnType<typeof renderInDraft>) => d.last().chat!;

describe("ChatCommandsSettings", () => {
  it("stages the complete chat object when chat monitoring is switched on", () => {
    const d = renderInDraft(<ChatCommandsSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Monitor chat" }));
    expect(lastChat(d)).toEqual({ ...DEFAULT_CONTROL_STATE.chat, enabled: true });
  });

  it("greys out everything below a switch that is off, with the reason", () => {
    renderInDraft(<ChatCommandsSettings />);
    expect(screen.getByText(/Chat isn't monitored on this channel/)).toBeInTheDocument();
    expect(screen.getByText(/Chat isn't monitored/).closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
  });

  it("explains that only the info commands answer while viewer commands are off", () => {
    renderInDraft(<ChatCommandsSettings />, { state: { chat: { enabled: true, promoteToTicker: false, commands: DEFAULT_CHAT_COMMAND_SETTINGS } } });
    expect(screen.getByText(/viewers can only ask :modes, :mode and :help/)).toBeInTheDocument();
  });

  it("stages who may use commands", () => {
    const d = renderInDraft(<ChatCommandsSettings />, { state: on() });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Who may use them" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Moderators"));
    expect(lastChat(d).commands.allowFrom).toBe("mods");
  });

  it("warns about quota when replies are switched on", () => {
    renderInDraft(<ChatCommandsSettings />, { state: on({ replyInChat: true }) });
    expect(screen.getByText(/50 units of the channel's 10,000 a day YouTube quota/)).toBeInTheDocument();
  });

  it("narrows the music modes, storing 'all' as an empty list and never none", () => {
    const d = renderInDraft(<ChatCommandsSettings />, { state: on() });
    const group = screen.getByRole("group", { name: "Music modes viewers may pick" });
    fireEvent.click(within(group).getByRole("checkbox", { name: "breaks" }));
    expect(lastChat(d).commands.music.allowed).toEqual(["chill", "lounge", "deep", "minimal"]);

    const one = renderInDraft(<ChatCommandsSettings />, { state: on({ music: { ...DEFAULT_CHAT_COMMAND_SETTINGS.music, allowed: ["deep"] } }) });
    const before = one.staged.length;
    fireEvent.click(within(screen.getAllByRole("group", { name: "Music modes viewers may pick" })[1]).getByRole("checkbox", { name: "deep" }));
    expect(one.staged.length).toBe(before);
  });

  it("keeps the default hold under the longest hold", () => {
    const d = renderInDraft(<ChatCommandsSettings />, { state: on() });
    const longest = screen.getAllByLabelText("Longest hold")[0];
    fireEvent.change(longest, { target: { value: "120" } });
    fireEvent.blur(longest);
    expect(lastChat(d).commands.music).toMatchObject({ maxHoldS: 120, holdS: 120 });
  });
});
