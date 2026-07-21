# YouTube setup — getting the values for `.env`

What you're producing by the end of this doc:

```bash
YOUTUBE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
YOUTUBE_REDIRECT_URI=http://localhost:10100/api/youtube/callback
APP_SECRET=some-long-random-string
```

Then you click **Connect YouTube** on `/admin/streams` once, and you're done forever
(the refresh token is stored encrypted in Mongo — you never paste a token by hand).

> The Google Cloud console reorganises its menus every few months. If a menu name
> below doesn't match, use the console search bar at the top — the underlying pages
> and their URLs are stable, so the direct links are the reliable bit.

---

## Step 0 — Enable live streaming on the YouTube channel (DO THIS FIRST)

**There is a 24-hour waiting period the first time.** If you skip this, everything
else works and then go-live fails at the last step.

1. Sign in to YouTube as the account that owns the channel you want to stream on.
2. Go to <https://www.youtube.com/features>
3. Enable **Live streaming**. You'll need to verify a phone number.
4. **Wait 24 hours.** Google will not let you stream before then, first time only.

Requirements: no live-streaming strikes in the last 90 days. Note that a channel
under a *Brand Account* is fine — you'll pick it during the consent step later.

---

## Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>
2. Project dropdown (top-left, next to the "Google Cloud" logo) → **New Project**.
3. Name it something like `WeatherChannel Live` → **Create**.
4. Make sure that new project is selected in the dropdown before continuing.

*You do not need billing enabled. The YouTube Data API has a free daily quota.*

---

## Step 2 — Enable the YouTube Data API v3

Direct link (with your project selected):
<https://console.cloud.google.com/apis/library/youtube.googleapis.com>

Click **Enable**.

(Manual path: **APIs & Services → Library** → search "YouTube Data API v3" → Enable.)

---

## Step 3 — Configure the OAuth consent screen

**APIs & Services → OAuth consent screen** (newer consoles: **Google Auth Platform →
Branding / Audience**).

1. **User type: External.** (Only pick Internal if this is a Google Workspace org
   account and the channel lives inside it.)
2. Fill the required fields:
   - **App name** — e.g. `WeatherChannel Live` (this is what you'll see on the consent screen)
   - **User support email** — your email
   - **Developer contact email** — your email
   - Everything else can be left blank.
3. **Scopes** — you can leave this empty; the app requests its scopes at runtime.
   If you want them listed, add:
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
4. **Test users** — add the Google account that owns the channel.

### ⚠️ The 7-day token trap — read this one

While the consent screen's **Publishing status is "Testing"**, Google issues refresh
tokens that **expire after 7 days**. Your stream would then silently fail to go live
a week later with an auth error.

**Fix: set Publishing status to "In production".**

On the OAuth consent screen page → **Publish app** → confirm.

Because the YouTube scopes are "sensitive", an unverified production app shows a
warning screen on first sign-in. That is fine for your own use — you click
**Advanced → Go to \<app name\> (unsafe)** once and proceed. You only need to submit
for Google verification if you want to remove that warning or let >100 people connect.
For a single-owner broadcast rig, publish + click through the warning.

---

## Step 4 — Create the OAuth client (this is where CLIENT_ID/SECRET come from)

**APIs & Services → Credentials** → **+ Create Credentials** → **OAuth client ID**.

- **Application type: Web application** ← must be "Web application", not "Desktop"
- **Name**: anything, e.g. `weatherchannel-web`
- **Authorized redirect URIs** → **+ Add URI**. Add one line per environment:

  | Environment | URI |
  |---|---|
  | Local dev | `http://localhost:10100/api/youtube/callback` |
  | Production | `https://YOUR-DOMAIN/api/youtube/callback` |

  This must match `YOUTUBE_REDIRECT_URI` in `.env` **character for character** —
  trailing slashes and http-vs-https count. Google only permits plain `http` for
  `localhost`.

  *(You can leave "Authorized JavaScript origins" empty — the app does a server-side
  redirect, not a browser JS flow.)*

- Click **Create**.

A dialog shows **Your Client ID** and **Your Client Secret**. **That dialog is where
the two values come from.** Copy both now (you can always re-open them later from the
Credentials list, and the secret can be re-downloaded from the client's detail page).

---

## Step 5 — Put them in the root `.env`

Edit `/home/rich/code/thronix/WeatherChannel/.env` (the root one — all services read it):

```bash
YOUTUBE_CLIENT_ID=<the Client ID from step 4>
YOUTUBE_CLIENT_SECRET=<the Client secret from step 4>
YOUTUBE_REDIRECT_URI=http://localhost:10100/api/youtube/callback

# Encrypts the stored YouTube refresh token at rest (AES-256-GCM).
# Any long random string. Generate one with:  openssl rand -base64 32
APP_SECRET=<long random string>
```

**Keep `APP_SECRET` stable.** If you change it, the stored refresh token can no longer
be decrypted and you'll have to click "Connect YouTube" again.

Then **restart `public` and `worker`** so they pick up the new env.

---

## Step 6 — Connect the channel (one click, once)

1. Open **`/admin/streams`**.
2. The YouTube chip should now offer a **Connect YouTube** button (if it says
   "not configured", the env didn't load — restart the services).
3. Click it → you're sent to Google.
4. **Choose the account that owns the channel.** If the channel is a Brand Account,
   Google shows a channel picker — pick the right channel here, not your personal one.
5. If you see "Google hasn't verified this app": **Advanced → Go to … (unsafe)**.
6. Grant the permissions → you land back on `/admin/streams` with a green
   "Connected YouTube channel: …" banner.

The encrypted refresh token is now in Mongo. You won't do this again unless you
disconnect, change `APP_SECRET`, or revoke access in your Google account.

---

## Step 7 — Go live

On `/control` (Stream panel) or `/admin/streams`:

- Tick **Publish to YouTube**, set a title, pick privacy (**start with Unlisted**),
  optionally an auto-end in minutes, then **● Go Live**.
- The app creates the broadcast, points OBS at the ingest URL, starts OBS, waits for
  bytes, then transitions YouTube to live. Status goes
  `STARTING → AWAITING INGEST → LIVE`.
- **End stream** transitions the broadcast to complete and stops OBS.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri_mismatch` | The URI in step 4 ≠ `YOUTUBE_REDIRECT_URI`. Compare exactly: scheme, host, port, path, trailing slash. |
| "Google returned no refresh token" | Happens if Google already granted consent without `prompt=consent`. Revoke the app at <https://myaccount.google.com/permissions> and reconnect. |
| Auth works, then breaks ~7 days later | Consent screen still in **Testing**. Publish the app (step 3) and reconnect. |
| `livePermissionBlocked` / `liveStreamingNotEnabled` | Step 0 not done, or the 24h wait hasn't elapsed, or you authorized the wrong channel (personal vs Brand Account). |
| Run sits on **AWAITING INGEST** forever | That's the OBS side, not YouTube — see [obs-setup.md](obs-setup.md). The panel will show the stream key to paste manually. |
| `quotaExceeded` | Default is 10,000 units/day. Each go-live costs ~200 units (insert 50 + insert 50 + bind 50 + transition 50); health polling is 1 unit per ~30s. That's fine for normal use; request more quota in the console if you're cycling broadcasts hard. |
| "connect a YouTube channel first" when going live | No account stored — do step 6. |

**To disconnect:** `/admin/streams` → Disconnect. Also revoke at
<https://myaccount.google.com/permissions> if you want it gone from the Google side.
