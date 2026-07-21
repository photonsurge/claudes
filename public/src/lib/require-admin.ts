import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession, isAdmin, type SessionPayload } from "@photonsurge/shared/utill/session";

/** The current operator session from the request cookie, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? readSession(token) : null;
}

/**
 * Admin session or null. Route handlers for the sensitive streaming surface
 * (go-live, OAuth connect, stream-key reveal) call this and 401 on null — these
 * are more dangerous than a director toggle, so they gate explicitly rather than
 * relying on deployment-level protection.
 */
export async function requireAdmin(): Promise<SessionPayload | null> {
  const session = await getSession();
  return isAdmin(session) ? session : null;
}
