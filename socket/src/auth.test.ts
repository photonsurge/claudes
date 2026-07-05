import { generateShortLivedJwt } from "@photonsurge/shared/utill/jwt";
import { authenticateSocket } from "./auth";

const SECRET = "test-socket-secret";

function makeSocket(auth: Record<string, unknown>) {
  return {
    id: "sock1",
    handshake: { auth, address: "127.0.0.1", headers: {} },
  } as any;
}

describe("authenticateSocket — user actor role propagation", () => {
  const OLD_SECRET = process.env.SOCKET_TOKEN_SECRET;

  beforeEach(() => {
    process.env.SOCKET_TOKEN_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.SOCKET_TOKEN_SECRET = OLD_SECRET;
  });

  it("an admin-role token yields roles [user, admin] and control:emit scope", async () => {
    const token = generateShortLivedJwt({ sub: "u1", role: "admin", actorType: "user" }, "5m", SECRET);
    const res = await authenticateSocket(makeSocket({ token, actorType: "user" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.context.roles).toEqual(["user", "admin"]);
    expect(res.context.scopes).toContain("control:emit");
  });

  it("a guest token (no role claim) yields only the user role, no control:emit scope", async () => {
    const token = generateShortLivedJwt({ sub: "guest-abc", actorType: "user" }, "5m", SECRET);
    const res = await authenticateSocket(makeSocket({ token, actorType: "user" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.context.roles).toEqual(["user"]);
    expect(res.context.scopes).not.toContain("control:emit");
  });

  it("rejects a token with no actorType claim mismatch entirely if missing token/actorType", async () => {
    const res = await authenticateSocket(makeSocket({}));
    expect(res.ok).toBe(false);
  });
});
