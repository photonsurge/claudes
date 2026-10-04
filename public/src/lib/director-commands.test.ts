import { dropCommand, fetchCommands, sendCommand } from "./director-commands";

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

describe("sendCommand", () => {
  it("posts the op to the scene's queue", async () => {
    fetchMock.mockResolvedValue(reply(202, { command: { id: "c1" } }));
    expect(await sendCommand("my scene", { op: "skip" })).toEqual({ ok: true, command: { id: "c1" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/director/my%20scene/commands", expect.objectContaining({ method: "POST", body: '{"op":"skip"}' }));
  });

  it("surfaces a refusal's reason", async () => {
    fetchMock.mockResolvedValue(reply(409, { command: { id: "c1", note: "director is off" } }));
    expect(await sendCommand("s", { op: "skip" })).toEqual({ ok: false, error: "director is off" });
  });

  it("surfaces an API error, or the status when there is no body", async () => {
    fetchMock.mockResolvedValue(reply(400, { error: "Invalid command" }));
    expect(await sendCommand("s", { op: "skip" })).toEqual({ ok: false, error: "Invalid command" });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("x"); } });
    expect(await sendCommand("s", { op: "skip" })).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await sendCommand("s", { op: "skip" })).toEqual({ ok: false, error: "Error: offline" });
  });
});

describe("fetchCommands / dropCommand", () => {
  it("reads the log, empty on failure", async () => {
    fetchMock.mockResolvedValue(reply(200, { commands: [{ id: "c1" }] }));
    expect(await fetchCommands("s", 5)).toEqual([{ id: "c1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/director/s/commands?limit=5");
    fetchMock.mockResolvedValue(reply(401, {}));
    expect(await fetchCommands("s")).toEqual([]);
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchCommands("s")).toEqual([]);
  });

  it("drops one command", async () => {
    fetchMock.mockResolvedValue(reply(200, { dropped: true }));
    expect(await dropCommand("s", "c 1")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/director/s/commands/c%201", { method: "DELETE" });
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await dropCommand("s", "c1")).toBe(false);
  });
});
