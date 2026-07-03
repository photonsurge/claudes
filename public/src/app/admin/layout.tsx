import Link from "next/link";

/**
 * Admin section layout — a slim sticky bar with a link back to the launcher,
 * shared by /admin and every /admin/* page so there's always a way home without
 * touching each page. The admin pages render their own full-bleed <main> below.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 40,
          padding: "0 16px",
          background: "#0c111c",
          borderBottom: "1px solid #1b2030",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
        }}
      >
        <Link href="/" style={{ color: "#8b95a7", textDecoration: "none" }}>
          ← Home
        </Link>
        <span style={{ color: "#3a4152" }}>/</span>
        <Link href="/admin" style={{ color: "#cdd4e0", textDecoration: "none" }}>
          Admin
        </Link>
      </header>
      {children}
    </>
  );
}
