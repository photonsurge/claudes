/**
 * RunChatDialog fetches the full logged history when opened (never while
 * closed) and renders the three states: messages, empty log, fetch error.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ChatMessage } from "@photonsurge/shared/runs";

const mockFetchChatLog = jest.fn();
jest.mock("../../../lib/chat", () => ({
  fetchChatLog: (...a: unknown[]) => mockFetchChatLog(...a),
}));

import RunChatDialog from "./RunChatDialog";

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  runId: "r1",
  sceneId: "main",
  platform: "youtube",
  id,
  author: `author-${id}`,
  text: `text-${id}`,
  ts: 1_700_000_000_000,
  ...extra,
});

beforeEach(() => {
  mockFetchChatLog.mockReset().mockResolvedValue([]);
});

it("does not fetch while closed", () => {
  render(<RunChatDialog runId="r1" title="Weather" open={false} onClose={() => {}} />);
  expect(mockFetchChatLog).not.toHaveBeenCalled();
});

it("fetches on open and renders the messages (superchat included)", async () => {
  mockFetchChatLog.mockResolvedValue([msg("a"), msg("b", { superchatAmount: "$5.00" })]);
  render(<RunChatDialog runId="r1" title="Weather" open onClose={() => {}} />);
  expect(mockFetchChatLog).toHaveBeenCalledWith("r1");
  await waitFor(() => expect(screen.getByText(/text-a/)).toBeInTheDocument());
  expect(screen.getByText("author-b")).toBeInTheDocument();
  expect(screen.getByText(/\$5\.00/)).toBeInTheDocument();
  expect(screen.getByText(/2 messages/)).toBeInTheDocument();
});

it("shows the empty state for a run with no logged chat", async () => {
  render(<RunChatDialog runId="r1" title="Weather" open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/No chat logged/)).toBeInTheDocument());
});

it("surfaces a fetch error", async () => {
  mockFetchChatLog.mockRejectedValue(new Error("chat log fetch failed (401)"));
  render(<RunChatDialog runId="r1" title="Weather" open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/chat log fetch failed/)).toBeInTheDocument());
});
