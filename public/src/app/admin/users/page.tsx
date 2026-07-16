"use client";

/**
 * /admin/users — admin accounts. Create-only for v1 (no edit/delete UI yet);
 * `role` is a free select so a second role can be added later without UI churn.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";

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
    <AdminPageShell title="Users" description="Admin accounts for /admin and /control." maxWidth={760}>
      {/* Create */}
      <Paper sx={{ p: 1.75, mt: 1.75 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            slotProps={{ htmlInput: { "aria-label": "Email" } }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="password (min 8 chars)"
            onKeyDown={(e) => e.key === "Enter" && email.trim() && password && add()}
            slotProps={{ htmlInput: { "aria-label": "Password" } }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          {/* The page's one genuinely primary action, so the one filled button. */}
          <Button variant="contained" onClick={add} disabled={busy || !email.trim() || password.length < 8}>
            {busy ? "…" : "Create"}
          </Button>
        </Stack>
      </Paper>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {/* List */}
      <Box sx={{ display: "grid", gap: 1.25, mt: 2.25 }}>
        {users.map((u) => (
          <Paper key={u.id} sx={{ p: 1.75 }}>
            <Stack direction="row" spacing={1.75} sx={{ alignItems: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {u.email}
                  </Typography>
                  <Chip label={u.role} />
                  {!u.active && <Chip label="disabled" color="error" />}
                </Stack>
                <Typography variant="caption" color="text.secondary" component="div">
                  {u.lastLoginAt ? `Last login ${new Date(u.lastLoginAt).toLocaleString()}` : "Never logged in"}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        ))}
      </Box>
    </AdminPageShell>
  );
}
