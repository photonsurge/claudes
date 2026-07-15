"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AdminTextSize, { useAdminTextScale } from "./AdminTextSize";

interface AdminPageShellProps {
  title: string;
  description?: React.ReactNode;
  /** Column cap; `"none"` lets the page use the full viewport. */
  maxWidth?: number | string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  crumbs?: Array<{ href?: string; label: string }>;
}

export default function AdminPageShell({
  title,
  description,
  maxWidth = 1100,
  actions,
  children,
  crumbs = [],
}: AdminPageShellProps) {
  const [scale, setScale] = useAdminTextScale();
  const allCrumbs = [{ href: "/", label: "Home" }, { href: "/admin", label: "Admin" }, ...crumbs];
  const terminalCrumbs =
    title === "Admin" && crumbs.length === 0
      ? [{ href: "/", label: "Home" }, { label: "Admin" }]
      : allCrumbs.length > 2
        ? allCrumbs
        : [...allCrumbs, { label: title }];

  return (
    <Box component="main" sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {/*
        `zoom` (not transform) so the page still reflows to the viewport width.
        It stays an inline style rather than going in `sx`: it changes per
        render, and `sx` would mint a fresh emotion class for every zoom level.
      */}
      <Box component="section" style={{ zoom: scale }} sx={{ maxWidth, mx: "auto", px: 3, pt: 2.75, pb: 4 }}>
        <Stack direction="row" sx={{ alignItems: "center", mb: 2.25 }}>
          <Breadcrumbs
            aria-label="Breadcrumb"
            separator="/"
            sx={{ fontSize: 12, "& .MuiBreadcrumbs-separator": { color: "text.disabled", mx: 0.875 } }}
          >
            {terminalCrumbs.map((crumb, i) =>
              crumb.href ? (
                <MuiLink key={`${crumb.label}.${i}`} component={Link} href={crumb.href} variant="caption" color="text.secondary">
                  {crumb.label}
                </MuiLink>
              ) : (
                <Typography key={`${crumb.label}.${i}`} variant="caption" color="text.primary" sx={{ fontWeight: 700 }}>
                  {crumb.label}
                </Typography>
              ),
            )}
          </Breadcrumbs>
          {/* Text size lives here so it's on every admin page, not just one. */}
          <Box sx={{ ml: "auto" }}>
            <AdminTextSize scale={scale} onScale={setScale} />
          </Box>
        </Stack>

        <Stack
          direction="row"
          spacing={2.25}
          sx={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", mb: 2.25 }}
        >
          <Box sx={{ minWidth: 240, flex: "1 1 360px" }}>
            <Typography variant="h1">{title}</Typography>
            {description ? (
              <Typography variant="body1" color="text.secondary" sx={{ mt: 0.875 }}>
                {description}
              </Typography>
            ) : null}
          </Box>
          {actions ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              {actions}
            </Stack>
          ) : null}
        </Stack>

        {children}
      </Box>
    </Box>
  );
}
