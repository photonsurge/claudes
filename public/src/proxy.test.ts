/** @jest-environment node */

/**
 * proxy.ts (Next's renamed `middleware`) is the ONLY gate in front of the
 * operator surface — /, /control, /admin/**, and the mutating halves of
 * /api/admin, /api/broadcast/state, /api/scenes/**. It had no test at all;
 * a wrong `needsAdmin`/`isPage` condition here silently exposes a page (no
 * redirect, no 401) or breaks the /login redirect for a legitimate gate.
 *
 * readSession/isAdmin are mocked (same pattern as public-stats/route.test.ts)
 * so this only exercises proxy's own routing logic, not JWT verification.
 */
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: (t: string) => mockReadSession(t),
  isAdmin: (s: unknown) => mockIsAdmin(s),
}));

const mockReadSession = jest.fn();
const mockIsAdmin = jest.fn();

import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const req = (pathname: string, opts: { method?: string; cookie?: string } = {}) =>
  new NextRequest(`http://localhost${pathname}`, {
    method: opts.method ?? "GET",
    headers: opts.cookie ? { cookie: `wc_session=${opts.cookie}` } : undefined,
  });

beforeEach(() => {
  mockReadSession.mockReset().mockReturnValue(null);
  mockIsAdmin.mockReset().mockReturnValue(false);
});

describe("proxy — anonymous requests", () => {
  it.each([["/"], ["/control"], ["/admin"], ["/admin/scenes"]])(
    "redirects the gated page %s to /login with ?next=",
    (pathname) => {
      const res = proxy(req(pathname));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(pathname);
    },
  );

  it("401s a gated API route instead of redirecting", () => {
    const res = proxy(req("/api/admin/worker-stats"));
    expect(res.status).toBe(401);
  });

  it("401s a scenes/broadcast-state MUTATION (POST/PATCH/DELETE)", () => {
    expect(proxy(req("/api/scenes", { method: "POST" })).status).toBe(401);
    expect(proxy(req("/api/scenes/atlantic", { method: "PATCH" })).status).toBe(401);
    expect(proxy(req("/api/scenes/atlantic", { method: "DELETE" })).status).toBe(401);
    expect(proxy(req("/api/broadcast/state", { method: "POST" })).status).toBe(401);
  });

  it("passes through a scenes/broadcast-state READ (GET/HEAD) ungated — dual-auth lives in the route", () => {
    expect(proxy(req("/api/scenes")).status).toBe(200);
    expect(proxy(req("/api/scenes/atlantic")).status).toBe(200);
    expect(proxy(req("/api/broadcast/state", { method: "HEAD" })).status).toBe(200);
  });

  it("never gates /watch/** — OBS/YouTube can't do interactive login", () => {
    expect(proxy(req("/watch/atlantic")).status).toBe(200);
  });

  it("leaves an ungated page alone (e.g. /login itself, /sandbox)", () => {
    expect(proxy(req("/login")).status).toBe(200);
    expect(proxy(req("/sandbox")).status).toBe(200);
  });
});

describe("proxy — sessioned requests", () => {
  it("admits a valid admin session to every gated surface", () => {
    mockReadSession.mockReturnValue({ sub: "1", email: "a@b.com", role: "admin" });
    mockIsAdmin.mockReturnValue(true);

    expect(proxy(req("/", { cookie: "tok" })).status).toBe(200);
    expect(proxy(req("/api/admin/worker-stats", { cookie: "tok" })).status).toBe(200);
    expect(proxy(req("/api/scenes", { method: "POST", cookie: "tok" })).status).toBe(200);
  });

  it("still redirects a non-admin session (cookie present, isAdmin false)", () => {
    mockReadSession.mockReturnValue({ sub: "1", email: "a@b.com", role: "viewer" });
    mockIsAdmin.mockReturnValue(false);

    const res = proxy(req("/control", { cookie: "tok" }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("401s (not redirects) an API route for an invalid/expired session cookie", () => {
    mockReadSession.mockReturnValue(null); // readSession's own catch-all for a bad token
    const res = proxy(req("/api/admin/worker-stats", { cookie: "garbage" }));
    expect(res.status).toBe(401);
  });
});
