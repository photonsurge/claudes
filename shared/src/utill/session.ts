/**
 * Admin login sessions. Single choke point for "what counts as a valid
 * session" / "what counts as admin" — middleware, the login/logout routes,
 * and the socket-token route all import this instead of hand-rolling JWT
 * checks, so adding a second role later means adding one `isX()` helper here,
 * not touching every call site.
 */
import { generateShortLivedJwt, validateJwt } from "./jwt";

export const SESSION_COOKIE = "wc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  sub: string;
  email: string;
  role: string;
}

const sessionSecret = (): string => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return secret;
};

export const signSession = (payload: SessionPayload): string =>
  generateShortLivedJwt({ ...payload, actorType: "session" }, SESSION_TTL_SECONDS, sessionSecret());

export const readSession = (token: string): SessionPayload | null => {
  try {
    const decoded = validateJwt(token, sessionSecret()) as Record<string, unknown>;
    if (decoded.actorType !== "session") return null;
    if (typeof decoded.sub !== "string" || typeof decoded.email !== "string" || typeof decoded.role !== "string") {
      return null;
    }
    return { sub: decoded.sub, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
};

export const isAdmin = (session: SessionPayload | null): boolean => !!session && session.role === "admin";
