import Link from "next/link";
import PublicChannels from "../PublicChannels";

/**
 * The public front door: the masthead, what's on air per channel, and the links
 * to watch it on YouTube. Nothing else — no operator surface, no service status,
 * no instance chrome (a viewer must never learn which box they're on, the same
 * rule as /watch). The signed-in view of the same URL is OperatorLauncher.
 *
 * `operator` is true when an admin session is looking at the public view on
 * purpose (`?view=public`); the footer link then leads back to their launcher
 * instead of to the sign-in page.
 */
export default function PublicHome({ operator = false }: { operator?: boolean }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/gods_banner_transparent.png"
        alt="G.O.D.S. — Global Orbital Detection System"
        style={{ width: "min(560px, 100%)", height: "auto", display: "block", marginTop: 12 }}
      />
      <h1 style={{ margin: "10px 0 0", fontSize: 30 }}>Live Weather Globe</h1>
      <p style={{ margin: 0, color: "#8b95a7", fontSize: 15, textAlign: "center" }}>
        NOAA weather · alerts · live satellites, aircraft & ships — streaming live on YouTube
      </p>

      <div style={{ marginTop: 26, width: "100%", display: "flex", justifyContent: "center" }}>
        <PublicChannels />
      </div>

      <footer style={{ marginTop: 34, fontSize: 12 }}>
        {operator ? (
          <Link href="/" style={{ color: "#8b95a7", textDecoration: "none" }}>
            Back to the operator view
          </Link>
        ) : (
          <Link href="/login?next=%2F" style={{ color: "#4b5563", textDecoration: "none" }}>
            Operator sign in
          </Link>
        )}
      </footer>
    </>
  );
}
