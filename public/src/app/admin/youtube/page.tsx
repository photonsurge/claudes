"use client";

/**
 * /admin/youtube — connect + diagnose the YouTube account used for live streaming.
 * The config checklist makes a misconfig visible (missing client id, wrong redirect
 * URI, no token-encryption key) instead of surfacing as a cryptic OAuth error, and
 * it shows the EXACT redirect URI to paste into the Google Cloud console.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { checkYoutube, connectYoutube, disconnectYoutube, type YoutubeCheck } from "../../../lib/stream";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { font } from "../../../theme/tokens";

interface YtStatus {
  configured: boolean;
  clientId: string | null;
  hasSecret: boolean;
  redirectUri: string;
  redirectFromEnv: boolean;
  tokenEncryption: boolean;
  obsConfigured: boolean;
  obsUrl: string | null;
  accounts: {
    channelId: string;
    channelTitle: string | null;
    connectedAt: number | null;
    connectedBy: string | null;
    scopes: string[];
    /** Worker-stamped when Google rejected the refresh token — the channel needs reconnecting. */
    authError: { kind: string; message: string; at: number } | null;
    lastOkAt: number | null;
  }[];
}

export default function YoutubePage() {
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ connected?: string; oauthError?: string }>({});
  // Per-channel "Check connection" state (worker-side token mint + 1-unit API call).
  const [checks, setChecks] = useState<Record<string, { busy?: boolean; result?: YoutubeCheck }>>({});
  const runCheck = async (channelId: string) => {
    setChecks((c) => ({ ...c, [channelId]: { busy: true } }));
    const result = await checkYoutube(channelId);
    setChecks((c) => ({ ...c, [channelId]: { result } }));
    refresh(); // the check may have stamped/cleared authError
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/youtube", { cache: "no-store" });
      if (res.status === 401) return setError("admin only");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as YtStatus);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const q = new URLSearchParams(window.location.search);
    setNotice({ connected: q.get("connected") ?? undefined, oauthError: q.get("error") ?? undefined });
  }, [refresh]);

  const ready = status?.configured && status?.tokenEncryption;

  return (
    <AdminPageShell
      title="YouTube"
      description={
        <>
          Connect the channel used to publish live streams, and check the OAuth wiring.
          Full walkthrough in <code>docs/youtube-setup.md</code>. Runs are started from{" "}
          <MuiLink component={Link} href="/admin/streams">Streams</MuiLink>.
        </>
      }
      maxWidth={780}
    >
      {notice.connected && (
        <Alert severity="success" sx={{ mt: 1 }}>
          Connected: {decodeURIComponent(notice.connected)}
        </Alert>
      )}
      {notice.oauthError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Connect failed: {decodeURIComponent(notice.oauthError)}
        </Alert>
      )}
      {error && error !== "admin only" && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {/* Config checklist */}
      <Paper sx={{ p: 2, mt: 1.75 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Configuration
        </Typography>
        <Stack spacing={0.75}>
          <Check ok={!!status?.clientId} label="OAuth client ID" detail={status?.clientId ?? "set GOOGLE_OAUTH_CLIENT_ID"} mono />
          <Check ok={!!status?.hasSecret} label="OAuth client secret" detail={status?.hasSecret ? "set" : "set GOOGLE_OAUTH_SECRET"} />
          <Check
            ok={!!status?.tokenEncryption}
            label="Token encryption key"
            detail={status?.tokenEncryption ? "set (APP_SECRET / SECRETBOX_KEY)" : "set APP_SECRET — required to store the refresh token"}
          />
          <Check
            ok={!!status?.obsConfigured}
            label="OBS encoder"
            detail={status?.obsUrl ?? "OBS_WEBSOCKET_URL unset — manual stream-key handoff"}
            warnOnly
            mono={!!status?.obsUrl}
          />
        </Stack>

        {status && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Redirect URI {status.redirectFromEnv ? "(from env)" : "(derived — set GOOGLE_OAUTH_REDIRECT_URI to pin it)"} — this
              exact string must be registered on the Google OAuth client:
            </Typography>
            <CopyRow value={status.redirectUri} />
          </Box>
        )}
      </Paper>

      {/* Connect / connected channels */}
      <Paper sx={{ p: 2, mt: 1.75 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: status?.accounts.length ? 1.5 : 0, flexWrap: "wrap" }} useFlexGap>
          <Typography variant="subtitle2">Channels</Typography>
          <Button variant="contained" disabled={!ready} onClick={connectYoutube}>
            {status?.accounts.length ? "Connect another" : "Connect YouTube"}
          </Button>
          {!ready && status && (
            <Typography variant="caption" color="text.secondary">
              Fix the configuration above first.
            </Typography>
          )}
        </Stack>

        <Stack spacing={1}>
          {status?.accounts.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No channel connected yet.
            </Typography>
          )}
          {status?.accounts.map((a) => (
            <Paper key={a.channelId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                {a.authError ? (
                  <Chip color="error" size="small" label="needs reconnect" />
                ) : (
                  <Chip color="success" size="small" label="connected" />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {a.channelTitle || a.channelId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono }}>
                    {a.channelId}
                    {a.connectedAt ? ` · ${new Date(a.connectedAt).toLocaleString()}` : ""}
                    {a.connectedBy ? ` · ${a.connectedBy}` : ""}
                    {a.lastOkAt ? ` · last OK ${new Date(a.lastOkAt).toLocaleString()}` : ""}
                  </Typography>
                </Box>
                <Button variant="outlined" size="small" disabled={!!checks[a.channelId]?.busy} onClick={() => runCheck(a.channelId)}>
                  {checks[a.channelId]?.busy ? "Checking…" : "Check connection"}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={async () => {
                    if (confirm(`Disconnect ${a.channelTitle || a.channelId}?`)) {
                      await disconnectYoutube(a.channelId);
                      refresh();
                    }
                  }}
                >
                  Disconnect
                </Button>
              </Stack>
              {a.authError && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Google rejected the stored token on {new Date(a.authError.at).toLocaleString()}: {a.authError.message}.{" "}
                  Click <strong>Connect another</strong> and authorize this channel again (a consent screen still in{" "}
                  <em>Testing</em> expires tokens after 7 days — see docs/youtube-setup.md).
                </Alert>
              )}
              {checks[a.channelId]?.result && <CheckResult r={checks[a.channelId].result!} />}
            </Paper>
          ))}
        </Stack>
      </Paper>
    </AdminPageShell>
  );
}

/** Outcome of a "Check connection" run: token, API, and today's quota at a glance. */
function CheckResult({ r }: { r: YoutubeCheck }) {
  const q = r.quota;
  const fmt = (ms: number) => new Date(ms).toLocaleString();
  return (
    <Alert severity={r.ok ? "success" : "warning"} sx={{ mt: 1 }}>
      <Stack spacing={0.25}>
        <Check ok={r.tokenOk} label="Refresh token" detail={r.tokenOk ? `mints access tokens${r.tokenExpiresAt ? ` (current one until ${fmt(r.tokenExpiresAt)})` : ""}` : r.error} />
        <Check ok={r.apiOk} label="Data API" detail={r.apiOk ? `reachable${r.channelTitle ? ` as ${r.channelTitle}` : ""}` : r.error} />
        {q && (
          <Check
            ok={!q.exhaustedUntil}
            warnOnly={!q.exhaustedUntil && q.spent > q.budget * 0.8}
            label="Quota today"
            detail={
              `${q.spent.toLocaleString()} / ${q.budget.toLocaleString()} units (worker-side count) · resets ${fmt(q.resetAt)}` +
              (q.exhaustedUntil ? ` · EXHAUSTED until ${fmt(q.exhaustedUntil)}` : "")
            }
          />
        )}
      </Stack>
    </Alert>
  );
}

function Check({ ok, label, detail, warnOnly, mono }: { ok: boolean; label: string; detail?: string; warnOnly?: boolean; mono?: boolean }) {
  const color = ok ? "#2bbe63" : warnOnly ? "#ffb454" : "#ff6b6b";
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Box component="span" sx={{ color, fontWeight: 700, width: 16 }}>
        {ok ? "✓" : warnOnly ? "!" : "✗"}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 170 }}>
        {label}
      </Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: mono ? font.mono : undefined, overflow: "hidden", textOverflow: "ellipsis" }}>
          {detail}
        </Typography>
      )}
    </Stack>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
      <Box
        component="code"
        sx={{ flex: 1, fontFamily: font.mono, fontSize: 13, p: "6px 10px", bgcolor: "action.hover", borderRadius: 1, overflowX: "auto", whiteSpace: "nowrap" }}
      >
        {value}
      </Box>
      <IconButton
        size="small"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="copy redirect URI"
      >
        {copied ? "✓" : "⧉"}
      </IconButton>
    </Stack>
  );
}
