/**
 * /admin/presenters — the master switch gates the Test buttons, and Test
 * speaks the text box in the presenter's voice and lists the take.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_PRESENTER } from "@photonsurge/shared/presenter";
import PresentersPage from "./page";

jest.mock("../../../components/admin/AdminPageShell", () => ({
  __esModule: true,
  default: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

let enabled: boolean;
let posts: any[];

beforeEach(() => {
  enabled = false;
  posts = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (u.startsWith("/api/admin/presenters/settings")) {
      enabled = JSON.parse(String(init?.body)).enabled;
      return reply({ ok: true, settings: { enabled } });
    }
    if (u.startsWith("/api/admin/presenters/tests") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return reply({
        ok: true,
        take: { id: "t1", label: "House voice", text: body.text, voice: body.voice, status: "ready", createdAt: "2026-10-04T12:00:00Z", presenterId: "house", createdBy: "" },
      });
    }
    if (u.startsWith("/api/admin/presenters/tests")) return reply({ takes: [] });
    return reply({ presenters: [DEFAULT_PRESENTER], settings: { enabled }, catalog: { models: [], fetchedAt: null }, samples: [] });
  }) as unknown as typeof fetch;
});

it("disables Test while the presenter is off, then speaks once switched on", async () => {
  await act(async () => {
    render(<PresentersPage />);
  });
  const test = screen.getByRole("button", { name: "Test House voice" });
  expect(test).toBeDisabled();
  expect(screen.getByText("Presenter off")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("switch", { name: "Presenter on" }));
  });
  expect(screen.getByText("Presenter on")).toBeInTheDocument();
  expect(test).toBeEnabled();

  await act(async () => {
    fireEvent.click(test);
  });
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ presenterId: "house", label: "House voice" });
  expect(posts[0].text).toMatch(/Good evening/);
  expect(screen.getByText("ready")).toBeInTheDocument();
});
