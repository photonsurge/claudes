import { isAdmin } from "@photonsurge/shared/utill/session";
import InstanceMark from "../components/InstanceMark";
import OperatorLauncher from "../components/home/OperatorLauncher";
import PublicHome from "../components/home/PublicHome";
import { instanceVars, resolveInstance } from "../lib/instance";
import { getSession } from "../lib/require-admin";

/**
 * Rendered per request: it reads the session cookie, and the operator view's
 * instance badge must be the box's OWN identity — live runs the image miranda
 * tested, so anything baked at build time would say "TEST" on live forever
 * (lib/instance.ts).
 */
export const dynamic = "force-dynamic";

/**
 * Home — one URL, two faces. Anyone gets the public front door (what's on air
 * and where to watch it on YouTube — PublicHome); a signed-in admin gets the
 * operator launcher instead (OperatorLauncher), with `?view=public` to see the
 * viewer's version without signing out. The page is therefore NOT gated in
 * proxy.ts any more; the operator content is gated right here by the session.
 *
 * The instance wash + badge belong to the operator face only: the public one
 * is viewer-facing output, and, like /watch, says nothing about which box it is.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [session, { view }] = await Promise.all([getSession(), searchParams]);
  const admin = isAdmin(session);
  const operator = admin && view !== "public";
  const instance = operator ? resolveInstance() : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        // The operator face is washed with this deployment's colour — the
        // launcher is where you pick a box, so it's where mistaking test for
        // live costs the most. The variables are set on this very element (they
        // apply to it too), so a static render can never freeze the build box's
        // identity here. The public face sets none and keeps the plain ground.
        background: "var(--inst-page, #0a0e16)",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        padding: 40,
        ...instanceVars(instance),
      } as React.CSSProperties}
    >
      {/* Which box am I on — fixed chrome, costs the layout nothing. Null on the public face. */}
      <InstanceMark instance={instance} />
      {operator ? <OperatorLauncher email={session!.email} /> : <PublicHome operator={admin} />}
    </main>
  );
}
