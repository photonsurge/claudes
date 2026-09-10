"use client";

import Link from "next/link";
import AppBar from "@mui/material/AppBar";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";
import { plateFor, type Instance } from "../../lib/instance";

/**
 * The sticky admin bar. Split out of app/admin/layout.tsx as a client
 * component on purpose: the layout is an async server component (it reads the
 * session cookie), and MUI's `component={Link}` polymorphism means passing a
 * component *function* as a prop — which can't cross the server→client
 * boundary. So the layout does the cookie read and hands us the email as a
 * plain string, and all the MUI lives here.
 *
 * The bar is also where /admin says WHICH deployment you're driving: the page
 * ground behind it is already washed with the instance colour (see
 * AdminThemeProvider), and the bar underlines itself in that colour and names
 * it. Three boxes run this image — a dev laptop, the test box and live — and
 * before this they were indistinguishable (lib/instance.ts).
 */
export default function AdminTopBar({ email, instance }: { email?: string; instance?: Instance | null }) {
  return (
    <AppBar
      position="sticky"
      elevation={0}
      // Page-coloured, not `background.paper`: admin_logo.png is NOT transparent
      // (solid #080a15), and on a lighter bar it reads as a pasted-on rectangle.
      // #080a15 and the page tone are within a few values of each other, so the
      // logo's edges disappear and the hairline alone carries the bar.
      sx={{
        bgcolor: "background.default",
        // The instance colour replaces the hairline here rather than adding a
        // second rule — a 2px coloured edge is the loudest thing this bar does.
        borderBottom: instance ? 2 : 1,
        borderColor: instance ? instance.color : "divider",
        backgroundImage: "none",
      }}
    >
      <Toolbar variant="dense" disableGutters sx={{ minHeight: 52, px: 2, gap: 1.5 }}>
        {/* The logo is the way home — it reads better than "← Home" and brands the console. */}
        <Link href="/" style={{ display: "flex", alignItems: "center" }} aria-label="Home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/admin_logo.png"
            alt="G.O.D.S. — Global Orbital Detection System"
            height={36}
            style={{ height: 36, width: "auto", display: "block" }}
          />
        </Link>
        <Typography variant="body2" color="text.disabled">
          /
        </Typography>
        <MuiLink component={Link} href="/admin" variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
          Admin
        </MuiLink>
        {instance && (
          <Chip
            label={instance.label}
            title={`This console is the ${instance.label} deployment`}
            sx={{ color: instance.color, borderColor: instance.color, bgcolor: plateFor(instance.color) }}
          />
        )}

        <Box sx={{ flex: 1 }} />

        {email && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {email}
            </Typography>
            <form action="/api/auth/logout" method="POST">
              <Button type="submit" variant="outlined" size="small">
                Log out
              </Button>
            </form>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}
