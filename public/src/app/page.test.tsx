/**
 * The home page's two faces. It used to be gated wholesale by proxy.ts; now the
 * gate is the session read right here, so "anonymous never sees an operator
 * control" is a property of this file and has to be pinned down here.
 *
 * The heavy client children (channel cards, status badge, service panel) are
 * stubbed — each has its own suite; this one is about WHICH face renders.
 */
import { render, screen } from "@testing-library/react";

jest.mock("../lib/require-admin", () => ({ getSession: jest.fn() }));
jest.mock("../components/PublicChannels", () => () => <div data-testid="public-channels" />);
jest.mock("../components/ChannelLauncher", () => () => <div data-testid="channel-launcher" />);
jest.mock("../components/StreamStatusBadge", () => () => null);
jest.mock("../components/ServiceStatusPanel", () => () => null);

import { getSession } from "../lib/require-admin";
import Home from "./page";

const mockSession = getSession as jest.MockedFunction<typeof getSession>;

const renderHome = async (view?: string) =>
  render(await Home({ searchParams: Promise.resolve(view ? { view } : {}) }));

describe("Home", () => {
  beforeEach(() => {
    process.env.TAG = "test";
  });
  afterEach(() => {
    delete process.env.TAG;
  });

  it("shows a viewer the public front door and no operator control", async () => {
    mockSession.mockResolvedValue(null);

    await renderHome();

    expect(screen.getByTestId("public-channels")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Operator sign in" })).toHaveAttribute("href", "/login?next=%2F");
    expect(screen.queryByTestId("channel-launcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Admin/ })).not.toBeInTheDocument();
    // …and never which box this is.
    expect(screen.queryByText("TEST")).not.toBeInTheDocument();
  });

  it("treats a non-admin session like a viewer", async () => {
    mockSession.mockResolvedValue({ sub: "1", email: "v@example.com", role: "viewer" });

    await renderHome();

    expect(screen.getByTestId("public-channels")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });

  it("shows an admin the operator launcher with who they are and a way out", async () => {
    mockSession.mockResolvedValue({ sub: "1", email: "ops@example.com", role: "admin" });

    await renderHome();

    expect(screen.getByTestId("channel-launcher")).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Admin/ })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Public view" })).toHaveAttribute("href", "/?view=public");
    expect(screen.queryByTestId("public-channels")).not.toBeInTheDocument();
    // The operator face says which box it is.
    expect(screen.getByText("TEST")).toBeInTheDocument();
  });

  it("lets an admin see the public face on request, with a way back", async () => {
    mockSession.mockResolvedValue({ sub: "1", email: "ops@example.com", role: "admin" });

    await renderHome("public");

    expect(screen.getByTestId("public-channels")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the operator view" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Operator sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });
});
