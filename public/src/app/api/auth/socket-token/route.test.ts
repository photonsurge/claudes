/** @jest-environment node */

/**
 * GET /api/auth/socket-token — specifically the socket URL it hands the
 * browser. The public image bakes NEXT_PUBLIC_SOCKET_URL at build time and
 * ./deployLive promotes that very :test image to live, so a per-host RUNTIME
 * override (SOCKET_PUBLIC_URL) has to win over the baked value.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: () => null,
  isAdmin: () => false,
}));
jest.mock("@photonsurge/shared/utill/jwt", () => ({ generateShortLivedJwt: () => "tok" }));

import { GET } from "./route";

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, SOCKET_TOKEN_SECRET: "s" };
  delete process.env.SOCKET_PUBLIC_URL;
  delete process.env.NEXT_PUBLIC_SOCKET_URL;
});
afterAll(() => {
  process.env = ENV;
});

const socketUrl = async () => ((await (await GET()).json()) as { socketUrl: string }).socketUrl;

describe("GET /api/auth/socket-token → socketUrl", () => {
  it("uses the baked NEXT_PUBLIC_SOCKET_URL by default", async () => {
    process.env.NEXT_PUBLIC_SOCKET_URL = "https://test.example";
    expect(await socketUrl()).toBe("https://test.example");
  });

  it("lets the runtime SOCKET_PUBLIC_URL override the baked value", async () => {
    process.env.NEXT_PUBLIC_SOCKET_URL = "https://test.example";
    process.env.SOCKET_PUBLIC_URL = "https://live.example";
    expect(await socketUrl()).toBe("https://live.example");
  });

  it("falls back to localhost when neither is set", async () => {
    expect(await socketUrl()).toBe("http://localhost:4000");
  });

  it("500s without SOCKET_TOKEN_SECRET", async () => {
    delete process.env.SOCKET_TOKEN_SECRET;
    expect((await GET()).status).toBe(500);
  });
});
