"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Container, Paper, Stack, TextField, Typography } from "@mui/material";

const RegisterPage = () => {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => setName(e.target.value);
  const onEmailChange = (e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value);
  const onPasswordChange = (e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const body = (await res.json()) as { ok: boolean; error?: string };

    if (!res.ok || !body.ok) {
      setBusy(false);
      setError(body.error ?? "Registration failed");
      return;
    }

    const signInRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });

    setBusy(false);

    if (!signInRes || signInRes.error) {
      router.push("/login");
      return;
    }

    router.push(signInRes.url || "/");
    router.refresh();
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack component="form" onSubmit={onSubmit} gap={2}>
          <Typography variant="h5">Create account</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Name" value={name} onChange={onNameChange} required fullWidth />
          <TextField label="Email" type="email" value={email} onChange={onEmailChange} required fullWidth />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={onPasswordChange}
            required
            helperText="Minimum 8 characters"
            fullWidth
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button href="/login" variant="text">
              Back to sign in
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
};

export default RegisterPage;
