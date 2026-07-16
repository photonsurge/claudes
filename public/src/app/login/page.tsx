"use client";

/**
 * /login — admin sign-in. Deliberately outside the middleware matcher (see
 * ../../middleware.ts) so it's always reachable even with no session.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Login failed");
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#0c111c",
    color: "#cdd4e0",
    border: "1px solid #3a4152",
    borderRadius: 6,
    padding: "9px 10px",
    fontSize: 14,
    fontFamily: "inherit",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0c111c",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 320,
          padding: 28,
          borderRadius: 10,
          border: "1px solid #1b2030",
          background: "#10151f",
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 18, color: "#cdd4e0" }}>Sign in</h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8b95a7" }}>Admin access only.</p>

        <label style={{ display: "block", fontSize: 12, color: "#8b95a7", marginBottom: 4 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          autoComplete="username"
          style={inputStyle}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "14px 0 4px" }}>
          <label style={{ fontSize: 12, color: "#8b95a7" }}>Password</label>
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 12,
              color: "#6b93e0",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 12 }}>{error}</div>}

        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "10px 0",
            borderRadius: 6,
            border: "1px solid #3a4152",
            background: busy || !email || !password ? "#1a1f2b" : "#2563eb",
            color: "#fff",
            fontSize: 14,
            cursor: busy || !email || !password ? "default" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
