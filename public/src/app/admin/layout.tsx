import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession } from "@photonsurge/shared/utill/session";

/**
 * Admin section layout — a slim sticky bar with a link back to the launcher,
 * shared by /admin and every /admin/* page so there's always a way home without
 * touching each page. The admin pages render their own full-bleed <main> below.
 *
 * Reads the session server-side to show who's logged in + a logout button.
 * By the time this renders, proxy.ts has already verified the session, so
 * `session` is practically always set here — the check is just defensive.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? readSession(token) : null;

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          height: 40,
          padding: "0 16px",
          background: "#0c111c",
          borderBottom: "1px solid #1b2030",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* The logo is the way home — it reads better than "← Home" and brands the console. */}
          <Link href="/" style={{ display: "flex", alignItems: "center" }} aria-label="Home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/gods_banner_transparent.png"
              alt="G.O.D.S. — Global Orbital Detection System"
              height={28}
              style={{ height: 28, width: "auto", display: "block" }}
            />
          </Link>
          <span style={{ color: "#3a4152" }}>/</span>
          <Link href="/admin" style={{ color: "#cdd4e0", textDecoration: "none" }}>
            Admin
          </Link>
        </div>
        {session && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#8b95a7" }}>
            <span>{session.email}</span>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                style={{
                  background: "none",
                  border: "1px solid #3a4152",
                  color: "#cdd4e0",
                  borderRadius: 4,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                Log out
              </button>
            </form>
          </div>
        )}
      </header>
      {children}
    </>
  );
}
