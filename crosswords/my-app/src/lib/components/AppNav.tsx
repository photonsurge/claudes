"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { AppBar, Box, Button, Toolbar, Typography } from "@mui/material";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/words", label: "Words" },
  { href: "/mysteries", label: "Mysteries" },
  { href: "/wizard", label: "Wizard" },
  { href: "/audio", label: "Audio" },
  { href: "/hls", label: "HLS" },
  { href: "/mystery", label: "Mystery" },
  { href: "/stream", label: "Stream" },
];

const AppNav = () => {
  const { data: session, status } = useSession();
  const isAuthed = !!session?.user;

  return (
    <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
      <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
        <Typography variant="h6" sx={{ mr: 1 }}>
          Thronix Saturn
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {NAV_ITEMS.map((item) => (
            <Button key={item.href} component={Link} href={item.href} size="small" color="inherit" variant="text">
              {item.label}
            </Button>
          ))}
        </Box>
        <Box sx={{ marginLeft: "auto", display: "flex", gap: 1 }}>
          {status === "loading" ? null : isAuthed ? (
            <>
              <Button component={Link} href="/account" size="small" color="inherit" variant="outlined">
                Account
              </Button>
              <Button
                size="small"
                color="inherit"
                variant="contained"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button component={Link} href="/login" size="small" color="inherit" variant="outlined">
                Sign in
              </Button>
              <Button component={Link} href="/register" size="small" color="inherit" variant="contained">
                Register
              </Button>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default AppNav;
