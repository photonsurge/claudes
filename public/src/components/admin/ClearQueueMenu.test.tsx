/**
 * ClearQueueMenu — confirm-gating, the POST each path sends, and the menu.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ClearQueueMenu from "./ClearQueueMenu";

const COUNTS = { active: 1, waiting: 2, prioritized: 3, delayed: 0, failed: 4, completed: 5, paused: 0 };

function mockFetch(body: unknown = { ok: true, detail: { removed: { wait: 2, failed: 4 } } }) {
  const fn = jest.fn().mockResolvedValue({ json: async () => body, status: 200 });
  (global as any).fetch = fn;
  return fn;
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Clear one state" }));
const posted = (fn: jest.Mock) => JSON.parse(fn.mock.calls[0][1].body);

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

describe("ClearQueueMenu", () => {
  it("totals every state in the main button", () => {
    render(<ClearQueueMenu counts={COUNTS} />);
    expect(screen.getByRole("button", { name: /Clear queue \(15\)/ })).toBeInTheDocument();
  });

  it("disables the clear-all button when the queue is empty or unreachable", () => {
    const { rerender } = render(<ClearQueueMenu counts={null} />);
    expect(screen.getByRole("button", { name: /Clear queue/ })).toBeDisabled();
    rerender(<ClearQueueMenu counts={{ active: 0, waiting: 0 }} />);
    expect(screen.getByRole("button", { name: /Clear queue/ })).toBeDisabled();
  });

  it("does nothing when the confirm is dismissed", () => {
    const fetchMock = mockFetch();
    jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<ClearQueueMenu counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear queue/ }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears every state when the main button is confirmed", async () => {
    const fetchMock = mockFetch();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const onDone = jest.fn();

    render(<ClearQueueMenu counts={COUNTS} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear queue/ }));

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/queue", expect.objectContaining({ method: "POST" }));
    // No `states` → the API clears the lot.
    expect(posted(fetchMock)).toEqual({ action: "clear" });
    await waitFor(() => expect(screen.getByText("cleared 6")).toBeInTheDocument());
    expect(onDone).toHaveBeenCalled();
  });

  it("lists each state with its count and clears just the one picked", async () => {
    const fetchMock = mockFetch({ ok: true, detail: { removed: { failed: 4 } } });
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ClearQueueMenu counts={COUNTS} />);
    openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /failed 4/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /completed 5/ })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /failed 4/ }));

    expect(posted(fetchMock)).toEqual({ action: "clear", states: ["failed"] });
    await waitFor(() => expect(screen.getByText("cleared 4")).toBeInTheDocument());
    // Picking an item closes the menu.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables menu states that hold no jobs", () => {
    render(<ClearQueueMenu counts={COUNTS} />);
    openMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /delayed 0/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /active 1/ })).toBeEnabled();
  });

  it("closes the menu on Escape", () => {
    render(<ClearQueueMenu counts={COUNTS} />);
    openMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("says when schedules were dropped, since only a worker restart brings them back", async () => {
    mockFetch({ ok: true, detail: { removed: { wait: 21, prioritized: 5 }, schedulers: 26 } });
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ClearQueueMenu counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear queue/ }));

    await waitFor(() =>
      expect(screen.getByText("cleared 26 · 26 schedules dropped — restart the worker")).toBeInTheDocument(),
    );
  });

  it("stays quiet about schedules when none were dropped", async () => {
    mockFetch({ ok: true, detail: { removed: { failed: 4 }, schedulers: 0 } });
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ClearQueueMenu counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear queue/ }));

    await waitFor(() => expect(screen.getByText("cleared 4")).toBeInTheDocument());
  });

  it("surfaces a server-side failure", async () => {
    mockFetch({ ok: false, error: "Redis down" });
    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<ClearQueueMenu counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear queue/ }));

    await waitFor(() => expect(screen.getByText("failed: Redis down")).toBeInTheDocument());
  });
});
