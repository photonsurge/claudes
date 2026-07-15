"use client";

import Link from "next/link";

interface AdminPageShellProps {
  title: string;
  description?: React.ReactNode;
  /** Column cap; `"none"` lets the page use the full viewport. */
  maxWidth?: number | string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  crumbs?: Array<{ href?: string; label: string }>;
}

const linkStyle: React.CSSProperties = {
  color: "#8b95a7",
  textDecoration: "none",
};

export default function AdminPageShell({
  title,
  description,
  maxWidth = 1100,
  actions,
  children,
  crumbs = [],
}: AdminPageShellProps) {
  const allCrumbs = [{ href: "/", label: "Home" }, { href: "/admin", label: "Admin" }, ...crumbs];
  const terminalCrumbs =
    title === "Admin" && crumbs.length === 0
      ? [{ href: "/", label: "Home" }, { label: "Admin" }]
      : allCrumbs.length > 2
        ? allCrumbs
        : [...allCrumbs, { label: title }];

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth, margin: "0 auto", padding: "22px 24px 32px" }}>
        <nav
          aria-label="Breadcrumb"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 18,
            color: "#5b6577",
            fontSize: 12,
          }}
        >
          {terminalCrumbs.map((crumb, i) => (
            <span key={`${crumb.label}.${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {i > 0 && <span style={{ color: "#323a4b" }}>/</span>}
              {crumb.href ? (
                <Link href={crumb.href} style={linkStyle}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: "#dfe7f5", fontWeight: 700 }}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 18,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div style={{ minWidth: 240, flex: "1 1 360px" }}>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0, color: "#f8fafc" }}>{title}</h1>
            {description ? <div style={{ color: "#8b95a7", marginTop: 7, fontSize: 14, lineHeight: 1.45 }}>{description}</div> : null}
          </div>
          {actions ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{actions}</div> : null}
        </header>

        {children}
      </section>
    </main>
  );
}
