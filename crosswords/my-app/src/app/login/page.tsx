"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Container, Paper, Stack, TextField, Typography } from "@mui/material";

const LoginPage = () => {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onEmailChange = (e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value);
  const onPasswordChange = (e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setBusy(false);

    if (!res || res.error) {
      setError("Invalid email or password");
      return;
    }

    router.push(res.url || callbackUrl);
    router.refresh();
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack component="form" onSubmit={onSubmit} gap={2}>
          <Typography variant="h5">Sign in</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={onEmailChange}
            required
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={onPasswordChange}
            required
            fullWidth
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button href="/register" variant="text">
              Create account
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
};

export default LoginPage;
