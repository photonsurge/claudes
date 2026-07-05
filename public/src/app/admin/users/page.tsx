"use client";

/**
 * /admin/users — admin accounts. Create-only for v1 (no edit/delete UI yet);
 * `role` is a free select so a second role can be added later without UI churn.
 */
import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  active: boolean;
  created?: string;
  lastLoginAt?: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setUsers(Array.isArray(json?.users) ? json.users : []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, role: "admin" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setEmail("");
      setPassword("");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <p style={{ color: "#8b95a7", marginTop: 6 }}>Admin accounts for /admin and /control.</p>

        {/* Create */}
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            padding: 14,
            borderRadius: 8,
            border: "1px solid #1b2030",
            background: "#0c111c",
            marginTop: 14,
          }}
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            style={{ flex: 1, minWidth: 200, background: "#0a0e16", color: "#fff", border: "1px solid #2a3344", borderRadius: 6, padding: "8px 10px" }}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="password (min 8 chars)"
            onKeyDown={(e) => e.key === "Enter" && email.trim() && password && add()}
            style={{ flex: 1, minWidth: 200, background: "#0a0e16", color: "#fff", border: "1px solid #2a3344", borderRadius: 6, padding: "8px 10px" }}
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !email.trim() || password.length < 8}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #333",
              background: busy || !email.trim() || password.length < 8 ? "#1a1f2b" : "#2563eb",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {busy ? "…" : "Create"}
          </button>
        </div>
        {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>{error}</div>}

        {/* List */}
        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {u.email}
                  <span style={{ fontSize: 11, color: "#8b95a7", border: "1px solid #2a3344", borderRadius: 4, padding: "1px 5px", marginLeft: 8 }}>
                    {u.role}
                  </span>
                  {!u.active && (
                    <span style={{ fontSize: 11, color: "#fca5a5", border: "1px solid #5b2330", borderRadius: 4, padding: "1px 5px", marginLeft: 8 }}>
                      disabled
                    </span>
                  )}
                </div>
                <div style={{ color: "#8b95a7", fontSize: 12 }}>
                  {u.lastLoginAt ? `Last login ${new Date(u.lastLoginAt).toLocaleString()}` : "Never logged in"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
