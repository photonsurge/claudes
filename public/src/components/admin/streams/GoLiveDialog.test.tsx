/**
 * The Go live dialog (crossword plan §10): the channel filled in, the YouTube
 * channel preselected from the channel record and named on the button, live or
 * held encoders unchoosable, a crossword channel with no YouTube channel
 * refused, and the same POST /api/streams a one-off run makes.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GoLiveDialog from "./GoLiveDialog";

const occ = (state: string, label: string) => ({ state, label, canQueueVideo: state !== "live" && state !== "held", queued: 0 });
const SNAPSHOT = {
  youtubeConfigured: true,
  obsConfigured: true,
  accounts: [
    { channelId: "UCweather", channelTitle: "Weather TV" },
    { channelId: "UCword", channelTitle: "Word Up TV" },
    { channelId: "UCstale", channelTitle: "Stale TV", needsReconnect: true },
  ],
  encoders: [
    { id: "gpu-1", name: "GPU 1", url: "ws://a", enabled: true, hasPassword: false, use: "channels", sceneId: "default", occupancy: occ("live", "live: Main, since 14:02") },
    { id: "gpu-2", name: "GPU 2", url: "ws://b", enabled: true, hasPassword: false, use: "channels", occupancy: occ("held", "held by always-on slot Main") },
    { id: "gpu-3", name: "GPU 3", url: "ws://c", enabled: true, hasPassword: false, use: "channels", sceneId: "word-up", occupancy: occ("free", "free") },
  ],
  slots: [],
  runs: [] as { id: string; sceneId: string; status: string }[],
};

let posted: any[] = [];
let snapshot = SNAPSHOT;
let channelTitle = "Word Up %d/%m";
beforeEach(() => {
  posted = [];
  snapshot = { ...SNAPSHOT, runs: [] };
  channelTitle = "Word Up %d/%m";
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/streams" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      return json({ id: "run-1", sceneId: body.sceneId, status: "scheduled" }, 201);
    }
    if (u === "/api/streams") return json(snapshot);
    if (u.startsWith("/api/scenes/")) return json({ youtube: { title: channelTitle, description: "", thumbnailUrl: "" } });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

const CROSSWORD = { id: "word-up", name: "Word Up", surface: "crossword" as const, youtubeAccountId: "UCword" };
const BARE_CROSSWORD = { id: "bare", name: "Bare", surface: "crossword" as const };
const WEATHER = { id: "wind", name: "Atlantic Wind", surface: "globe" as const };

const youtubeSelect = () => screen.getByRole("combobox", { name: "YouTube channel" });
const encoderSelect = () => screen.getByRole("combobox", { name: "Encoder" });

it("preselects the channel's YouTube channel and names it on the button", async () => {
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "Go live on Word Up TV" })).toBeEnabled();
  expect(youtubeSelect()).toHaveTextContent("Word Up TV");
});

it("posts the one-off run with the channel, encoder, account, privacy, title template and duration", async () => {
  const onStarted = jest.fn();
  const onClose = jest.fn();
  render(<GoLiveDialog open scene={CROSSWORD} onClose={onClose} onStarted={onStarted} />);
  const go = await screen.findByRole("button", { name: "Go live on Word Up TV" });
  fireEvent.change(screen.getByLabelText("Duration (min)"), { target: { value: "45" } });
  fireEvent.click(go);
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toEqual({
    sceneId: "word-up",
    encoderId: "gpu-3", // its own encoder, free
    accountId: "UCword",
    title: "Word Up %d/%m", // the channel's template, resolved by the worker
    privacy: "unlisted",
    durationMs: 45 * 60_000,
    platforms: { youtube: true },
    strictEncoder: true, // the server applies the dialog's encoder rules too
  });
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
});

it("lets the YouTube channel be changed for one run", async () => {
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  await screen.findByRole("button", { name: "Go live on Word Up TV" });
  fireEvent.mouseDown(youtubeSelect());
  fireEvent.click(screen.getByRole("option", { name: "Weather TV" }));
  fireEvent.click(screen.getByRole("button", { name: "Go live on Weather TV" }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0].accountId).toBe("UCweather");
  expect(posted[0].durationMs).toBeNull(); // open-ended
});

it("a crossword channel with no YouTube channel can't go live until one is picked", async () => {
  render(<GoLiveDialog open scene={BARE_CROSSWORD} onClose={jest.fn()} />);
  expect(await screen.findByText(/has no YouTube channel/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Go live" })).toBeDisabled());
  fireEvent.mouseDown(youtubeSelect());
  // No "default channel" to fall back to on a crossword.
  expect(screen.queryByRole("option", { name: "Default channel" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "Word Up TV" }));
  expect(screen.getByRole("button", { name: "Go live on Word Up TV" })).toBeEnabled();
});

it("an account that needs reconnecting can't be chosen", async () => {
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  await screen.findByRole("button", { name: "Go live on Word Up TV" });
  fireEvent.mouseDown(youtubeSelect());
  expect(screen.getByRole("option", { name: /Stale TV \(needs reconnecting\)/ })).toHaveAttribute("aria-disabled", "true");
});

it("a stored account that needs reconnecting is not preselected", async () => {
  render(<GoLiveDialog open scene={{ ...CROSSWORD, youtubeAccountId: "UCstale" }} onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Go live" })).toBeDisabled());
});

it("live and held encoders can't be chosen; a free one can", async () => {
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  await screen.findByRole("button", { name: "Go live on Word Up TV" });
  fireEvent.mouseDown(encoderSelect());
  const list = screen.getByRole("listbox");
  expect(within(list).getByRole("option", { name: /GPU 1/ })).toHaveAttribute("aria-disabled", "true");
  expect(within(list).getByRole("option", { name: /GPU 2/ })).toHaveAttribute("aria-disabled", "true");
  expect(within(list).getByRole("option", { name: /GPU 3/ })).not.toHaveAttribute("aria-disabled");
});

it("a weather channel with none stored keeps the default channel", async () => {
  render(<GoLiveDialog open scene={WEATHER} onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Go live on the default channel" }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toMatchObject({ sceneId: "wind", platforms: { youtube: true } });
  expect(posted[0].accountId).toBeUndefined();
  expect(posted[0].encoderId).toBeUndefined(); // auto: no encoder of its own
});

it("shows the server's refusal", async () => {
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url === "/api/streams" && init?.method === "POST") return json({ error: "encoder busy" }, 409);
    if (url === "/api/streams") return json(snapshot);
    return json({ youtube: { title: "" } });
  });
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Go live on Word Up TV" }));
  expect(await screen.findByText("encoder busy")).toBeInTheDocument();
});

it("says the channel is busy when it already has a run on air", async () => {
  snapshot = { ...SNAPSHOT, runs: [{ id: "r1", sceneId: "word-up", status: "live" }] };
  render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "Channel busy" })).toBeDisabled();
});

describe("a crossword channel's encoder (never auto)", () => {
  it("offers no auto option", async () => {
    render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Word Up TV" });
    fireEvent.mouseDown(encoderSelect());
    expect(within(screen.getByRole("listbox")).queryByRole("option", { name: /auto/ })).toBeNull();
  });

  it("without a free encoder of its own starts on the first free channel encoder", async () => {
    snapshot = {
      ...SNAPSHOT,
      encoders: [
        ...SNAPSHOT.encoders.slice(0, 2),
        { ...SNAPSHOT.encoders[2], sceneId: "elsewhere" },
      ],
    };
    render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go live on Word Up TV" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].encoderId).toBe("gpu-3");
  });

  it("with no free encoder at all it can't go live, and says why", async () => {
    snapshot = { ...SNAPSHOT, encoders: SNAPSHOT.encoders.slice(0, 2) };
    render(<GoLiveDialog open scene={CROSSWORD} onClose={jest.fn()} />);
    expect(await screen.findByText(/No encoder is free/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go live on Word Up TV" })).toBeDisabled();
  });

  it("a weather channel keeps auto", async () => {
    render(<GoLiveDialog open scene={WEATHER} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on the default channel" });
    fireEvent.mouseDown(encoderSelect());
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /auto/ })).toBeInTheDocument();
  });
});

describe("a weather channel whose stored account can't be used", () => {
  it("names the stored account as needing reconnecting, not 'Default channel', and can't go live on it", async () => {
    render(<GoLiveDialog open scene={{ ...WEATHER, youtubeAccountId: "UCstale" }} onClose={jest.fn()} />);
    const go = await screen.findByRole("button", { name: "Go live" });
    await waitFor(() => expect(go).toBeDisabled());
    expect(youtubeSelect()).toHaveTextContent("Stale TV (stored, needs reconnecting)");
    expect(youtubeSelect()).not.toHaveTextContent("Default channel");
    fireEvent.mouseDown(youtubeSelect());
    fireEvent.click(screen.getByRole("option", { name: "Weather TV" }));
    expect(screen.getByRole("button", { name: "Go live on Weather TV" })).toBeEnabled();
  });

  it("says when the stored account is not connected at all", async () => {
    render(<GoLiveDialog open scene={{ ...WEATHER, youtubeAccountId: "UCgone" }} onClose={jest.fn()} />);
    await waitFor(() => expect(youtubeSelect()).toHaveTextContent("UCgone (stored, not connected)"));
    expect(screen.getByRole("button", { name: "Go live" })).toBeDisabled();
  });
});
