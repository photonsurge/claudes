/**
 * The way out, for the operator surfaces that aren't /admin — the signed-in
 * home launcher, /control and /sandbox (/admin's MUI bar carries its own copy
 * in AdminTopBar). A plain form POST to /api/auth/logout: the route clears the
 * session cookie and answers a browser form with a 303 to /login.
 *
 * Deliberately a form, never a link: a GET log-out is prefetchable, and Next
 * would sign the operator out because a link scrolled into view.
 *
 * No session read here on purpose. It only renders where a session already had
 * to exist to get this far, so it never needs to know who it is signing out.
 * `compact` is the link-weight variant for a console header that is already
 * full of controls.
 */
export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const style: React.CSSProperties = compact
    ? {
        background: "none",
        border: "none",
        padding: 0,
        color: "#8b95a7",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }
    : {
        padding: "5px 12px",
        borderRadius: 6,
        border: "1px solid #2a3142",
        background: "#121826",
        color: "#fff",
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      };

  return (
    <form action="/api/auth/logout" method="POST" style={{ display: "inline-block", margin: 0 }}>
      <button type="submit" title="Sign out of the operator console" style={style}>
        Log out
      </button>
    </form>
  );
}
