import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession } from "@photonsurge/shared/utill/session";
import AdminThemeProvider from "../../theme/AdminThemeProvider";
import AdminTopBar from "../../components/admin/AdminTopBar";

/**
 * Admin section layout — a slim sticky bar with a link back to the launcher,
 * shared by /admin and every /admin/* page so there's always a way home without
 * touching each page. The admin pages render their own full-bleed <main> below.
 *
 * Also the mount point for the admin MUI theme: everything under /admin gets it,
 * nothing outside does (notably /watch — see AdminThemeProvider).
 *
 * Reads the session server-side to show who's logged in + a logout button.
 * By the time this renders, proxy.ts has already verified the session, so
 * `session` is practically always set here — the check is just defensive.
 * The bar itself is a client component (AdminTopBar) — see the note there.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? readSession(token) : null;

  return (
    <AdminThemeProvider>
      <AdminTopBar email={session?.email} />
      {children}
    </AdminThemeProvider>
  );
}
