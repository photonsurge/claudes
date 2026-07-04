import { signSession, readSession, isAdmin, type SessionPayload } from "./session";

describe("session helpers", () => {
  const OLD_ENV = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });

  afterAll(() => {
    process.env.SESSION_SECRET = OLD_ENV;
  });

  const payload: SessionPayload = { sub: "u1", email: "a@b.com", role: "admin" };

  it("round-trips a signed session", () => {
    const token = signSession(payload);
    expect(readSession(token)).toEqual(payload);
  });

  it("returns null for a garbage token", () => {
    expect(readSession("not-a-jwt")).toBeNull();
  });

  it("returns null when signed with a different secret", () => {
    const token = signSession(payload);
    process.env.SESSION_SECRET = "different-secret";
    expect(readSession(token)).toBeNull();
  });

  it("returns null for a token missing role", () => {
    // Simulate an unrelated token minted with the same secret/issuer shape.
    const token = signSession({ ...payload, role: undefined as unknown as string });
    expect(readSession(token)).toBeNull();
  });

  it("isAdmin is true only for role admin", () => {
    expect(isAdmin(payload)).toBe(true);
    expect(isAdmin({ ...payload, role: "viewer" })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});
