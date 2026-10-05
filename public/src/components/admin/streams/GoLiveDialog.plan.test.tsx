/**
 * Plan-written (crossword plan §10, §12 "Go live preselects the channel's
 * YouTube channel and is refused for a crossword channel with none"). The
 * dialog over a fake /api/streams snapshot and a fake channel state:
 *  - the encoder is picked; a live or held encoder can't be chosen;
 *  - the YouTube channel is preselected from the channel record and named in
 *    the button, and can be changed for one run;
 *  - a crossword channel with no YouTube channel stored or picked is refused
 *    with a message, as is one whose account needs reconnecting;
 *  - a weather channel keeps today's default account;
 *  - the run form posts the usual POST /api/streams.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GoLiveDialog from "./GoLiveDialog";

const occ = (state: string, label: string) => ({ state, label, canQueueVideo: state !== "live" && state !== "held", queued: 0 });
const enc = (id: string, sceneId: string | undefined, state: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  url: `ws://${id}`,
  enabled: true,
  hasPassword: false,
  use: "channels",
  ...(sceneId ? { sceneId } : {}),
  occupancy: occ(state, label),
  ...extra,
});

const ACCOUNTS = [
  { channelId: "UC-wx", channelTitle: "Weather Channel TV", connectedAt: 5 },
  { channelId: "UC-cw", channelTitle: "Crossword Live", connectedAt: 1 },
  { channelId: "UC-stale", channelTitle: "Old Puzzles", connectedAt: 3, needsReconnect: true },
];

function snapshotWith(encoders: unknown[], runs: unknown[] = []) {
  return { youtubeConfigured: true, obsConfigured: true, accounts: ACCOUNTS, encoders, slots: [], runs };
}

let snapshot: any;
let channelTitles: Record<string, string>;
let posted: any[];

beforeEach(() => {
  posted = [];
  channelTitles = { daily: "Daily Crossword %d/%m", atlantic: "" };
  snapshot = snapshotWith([
    enc("obs-live", "atlantic", "live", "live: Atlantic, since 09:00"),
    enc("obs-held", undefined, "held", "held by always-on slot Atlantic"),
    enc("obs-daily", "daily", "free", "free"),
    enc("obs-spare", undefined, "free", "free"),
  ]);
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/streams" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      return json({ id: "run-x", sceneId: body.sceneId, status: "scheduled" }, 201);
    }
    if (u === "/api/streams") return json(snapshot);
    const m = u.match(/^\/api\/scenes\/([^/?]+)/);
    if (m) return json({ youtube: { title: channelTitles[decodeURIComponent(m[1])] ?? "", description: "", thumbnailUrl: "" } });
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
});

const DAILY = { id: "daily", name: "Daily Crossword", surface: "crossword" as const, youtubeAccountId: "UC-cw" };
const NONE = { id: "nothing", name: "No Account Crossword", surface: "crossword" as const };
const ATLANTIC = { id: "atlantic", name: "Atlantic", surface: "globe" as const };

const youtubeSelect = () => screen.getByRole("combobox", { name: "YouTube channel" });
const encoderSelect = () => screen.getByRole("combobox", { name: "Encoder" });
const openOptions = (combo: HTMLElement) => {
  fireEvent.mouseDown(combo);
  return within(screen.getByRole("listbox"));
};

describe("the YouTube channel", () => {
  it("is preselected from the channel record and named in the button", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    const go = await screen.findByRole("button", { name: "Go live on Crossword Live" });
    expect(go).toBeEnabled();
    expect(youtubeSelect()).toHaveTextContent("Crossword Live");
  });

  it("is preselected for a weather channel that stores one too", async () => {
    render(<GoLiveDialog open scene={{ ...ATLANTIC, youtubeAccountId: "UC-cw" }} onClose={jest.fn()} />);
    expect(await screen.findByRole("button", { name: "Go live on Crossword Live" })).toBeEnabled();
  });

  it("goes out on the stored one when left alone", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go live on Crossword Live" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ sceneId: "daily", accountId: "UC-cw", platforms: { youtube: true } });
  });

  it("can be changed for one run: the button renames, the post carries the pick, and reopening starts on the stored one again", async () => {
    const { unmount } = render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Crossword Live" });
    openOptions(youtubeSelect());
    fireEvent.click(screen.getByRole("option", { name: "Weather Channel TV" }));
    const go = screen.getByRole("button", { name: "Go live on Weather Channel TV" });
    fireEvent.click(go);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].accountId).toBe("UC-wx");
    unmount();

    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    expect(await screen.findByRole("button", { name: "Go live on Crossword Live" })).toBeEnabled();
  });

  it("lists an account that needs reconnecting as such, and it can't be chosen", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Crossword Live" });
    const opts = openOptions(youtubeSelect());
    expect(opts.getByRole("option", { name: /Old Puzzles.*needs reconnecting/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a crossword channel is never put on a guessed account", () => {
  it("with none stored or picked it is refused with a message, and nothing is posted", async () => {
    render(<GoLiveDialog open scene={NONE} onClose={jest.fn()} />);
    expect(await screen.findByText(/no YouTube channel/i)).toBeInTheDocument();
    const go = await screen.findByRole("button", { name: /^Go live/ });
    await waitFor(() => expect(go).toBeDisabled());
    expect(go).not.toHaveTextContent(/default/i);
    fireEvent.click(go);
    expect(posted).toHaveLength(0);
  });

  it("offers no default account to fall back to", async () => {
    render(<GoLiveDialog open scene={NONE} onClose={jest.fn()} />);
    await screen.findByText(/no YouTube channel/i);
    const opts = openOptions(youtubeSelect());
    const choosable = opts.getAllByRole("option").filter((o) => o.getAttribute("aria-disabled") !== "true");
    expect(choosable.map((o) => o.textContent)).toEqual(["Weather Channel TV", "Crossword Live"]);
  });

  it("goes live once one is picked", async () => {
    render(<GoLiveDialog open scene={NONE} onClose={jest.fn()} />);
    await screen.findByText(/no YouTube channel/i);
    openOptions(youtubeSelect());
    fireEvent.click(screen.getByRole("option", { name: "Crossword Live" }));
    fireEvent.click(screen.getByRole("button", { name: "Go live on Crossword Live" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ sceneId: "nothing", accountId: "UC-cw" });
  });

  it("with a stored account that needs reconnecting it is refused, not preselected and not posted", async () => {
    render(<GoLiveDialog open scene={{ ...DAILY, youtubeAccountId: "UC-stale" }} onClose={jest.fn()} />);
    const go = await screen.findByRole("button", { name: /^Go live/ });
    await waitFor(() => expect(go).toBeDisabled());
    expect(go).not.toHaveTextContent("Old Puzzles");
    expect(screen.getByText(/reconnect|no YouTube channel/i)).toBeInTheDocument();
    fireEvent.click(go);
    expect(posted).toHaveLength(0);
  });
});

describe("a weather channel keeps today's default", () => {
  it("with none stored it can go live on the default account, and posts no account", async () => {
    render(<GoLiveDialog open scene={ATLANTIC} onClose={jest.fn()} />);
    const go = await screen.findByRole("button", { name: /^Go live on/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].sceneId).toBe("atlantic");
    expect(posted[0].accountId).toBeUndefined();
  });
});

describe("the encoder", () => {
  it("a live or held encoder can't be chosen; free ones can", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Crossword Live" });
    const opts = openOptions(encoderSelect());
    expect(opts.getByRole("option", { name: /OBS-LIVE/ })).toHaveAttribute("aria-disabled", "true");
    expect(opts.getByRole("option", { name: /OBS-HELD/ })).toHaveAttribute("aria-disabled", "true");
    expect(opts.getByRole("option", { name: /OBS-DAILY/ })).not.toHaveAttribute("aria-disabled");
    expect(opts.getByRole("option", { name: /OBS-SPARE/ })).not.toHaveAttribute("aria-disabled");
    // Each shows what it is doing.
    expect(opts.getByRole("option", { name: /OBS-LIVE/ })).toHaveTextContent("live: Atlantic");
    expect(opts.getByRole("option", { name: /OBS-HELD/ })).toHaveTextContent("held by always-on slot");
  });

  it("the picked encoder is posted with the run's channel", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Crossword Live" });
    openOptions(encoderSelect());
    fireEvent.click(screen.getByRole("option", { name: /OBS-SPARE/ }));
    fireEvent.click(screen.getByRole("button", { name: "Go live on Crossword Live" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ sceneId: "daily", encoderId: "obs-spare" });
  });

  it("does not start on a channel's own encoder while it is live", async () => {
    render(<GoLiveDialog open scene={{ ...ATLANTIC, youtubeAccountId: "UC-wx" }} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go live on Weather Channel TV" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].encoderId).not.toBe("obs-live");
  });
});

describe("title", () => {
  it("starts on the channel's YouTube title template, sent for the worker to resolve", async () => {
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    await screen.findByRole("button", { name: "Go live on Crossword Live" });
    await waitFor(() => expect(screen.getByLabelText("YouTube title (optional)")).toHaveValue("Daily Crossword %d/%m"));
    fireEvent.click(screen.getByRole("button", { name: "Go live on Crossword Live" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].title).toBe("Daily Crossword %d/%m");
  });

  it("with no template it sends no title, so the worker's default applies", async () => {
    channelTitles.daily = "";
    render(<GoLiveDialog open scene={DAILY} onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go live on Crossword Live" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].title).toBeUndefined();
  });
});
