jest.mock("../../lib/viewer", () => ({ useViewerState: jest.fn() }));
jest.mock("../../lib/chat", () => ({ useChatMessages: jest.fn(() => []) }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_CHAT_COMMAND_SETTINGS } from "@photonsurge/shared/chat-policy";
import { emptyViewerState } from "@photonsurge/shared/viewer";
import { useViewerState } from "../../lib/viewer";
import { useChatMessages } from "../../lib/chat";
import ViewerRequestsPanel from "./ViewerRequestsPanel";

const T = Date.UTC(2026, 9, 4, 12);
const chat = { enabled: true, promoteToTicker: false, commands: { ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true } };
const fetchMock = jest.fn();

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  global.fetch = fetchMock as unknown as typeof fetch;
  (useViewerState as jest.Mock).mockReturnValue(emptyViewerState("s1"));
});
afterEach(() => jest.useRealTimers());

it("is hidden unless the channel has viewer commands on", () => {
  const { container } = render(<ViewerRequestsPanel sceneId="s1" chat={DEFAULT_CONTROL_STATE.chat} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows what is on air and waiting, and clears it", async () => {
  (useViewerState as jest.Mock).mockReturnValue({
    ...emptyViewerState("s1"),
    active: { audioMode: { slot: "audioMode", value: "deep", label: "Deep", by: { author: "ann", platform: "sim" }, requestedAt: T, until: T + 120_000, holdMs: 120_000 } },
    queue: [{ slot: "audioMode", value: "chill", label: "Chill", by: { author: "bob", platform: "sim" }, requestedAt: T, until: 0, holdMs: 1 }],
  });
  render(<ViewerRequestsPanel sceneId="s1" chat={chat} />);
  expect(screen.getByLabelText("Viewer picks on air")).toHaveTextContent("Music: Deep · @ann · 2m leftWaiting: Chill");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/scenes/s1/viewer/clear", { method: "POST" });
});

it("says a message as a viewer through the simulator, and shows the transcript", async () => {
  (useChatMessages as jest.Mock).mockReturnValue([
    { id: "1", author: "tester", text: ":music deep", runId: "sim:s1", sceneId: "s1", platform: "youtube", ts: T },
    { id: "2", author: "🤖 channel", text: "@tester → Deep for 5 min", runId: "sim:s1", sceneId: "s1", platform: "youtube", ts: T, isOwner: true },
  ]);
  render(<ViewerRequestsPanel sceneId="s1" chat={chat} />);
  expect(useChatMessages).toHaveBeenCalledWith("sim:s1");
  fireEvent.change(screen.getByLabelText("Simulated message"), { target: { value: ":music deep" } });
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Say" }));
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/scenes/s1/chat-sim");
  expect(JSON.parse(init.body)).toEqual({ author: "tester", text: ":music deep", isMod: true });
  expect(screen.getByLabelText("Simulator transcript")).toHaveTextContent("🤖 channel: @tester → Deep for 5 min");
  expect(screen.getByLabelText("Simulated message")).toHaveValue("");
});

it("reports when the worker can't be reached", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  render(<ViewerRequestsPanel sceneId="s1" chat={chat} />);
  fireEvent.change(screen.getByLabelText("Simulated message"), { target: { value: ":skip" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Say" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("couldn't reach the worker");
});
