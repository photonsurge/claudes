# Customer Sandbox Embed — v1 Implementation Plan

> **Status: SHELVED (Aug 2026).** Planned but deliberately not started —
> pick up from Phase 0 when customer access becomes current again.

## What this is

The first shippable slice of [hydra-customer-access-integration-spec.md](hydra-customer-access-integration-spec.md):
hydra's backend mints a **time-limited embed session** via a signed
server-to-server API call, renders the returned one-use URL in an **iframe**,
and the customer lands in a **refined sandbox** — a curated, read-only-to-the-
broadcast version of the operator sandbox where they can fiddle with the globe
(map types, overlays, camera, place search) and have their tweaks remembered.

This corresponds to spec **Level 2** (purchased iframe viewing) as the
transport plus **Level 5** (customer sandbox) as the surface, skipping Levels
0/1/3/4 for now. Nothing here depends on the internal RBAC overhaul
([auth-rbac-audit-implementation-plan.md](auth-rbac-audit-implementation-plan.md))
— per the spec, customers are a **separate external-identity domain**, never
internal users, so the two efforts stay decoupled.

## Current-state findings (Aug 2026)

- `shared/src/utill/session.ts` is the single session choke point;
  `ALLOWED_ROLES = ["admin"]` only. We deliberately do **not** add a role —
  customer access uses a distinct JWT `actorType` so `isAdmin()` can never
  match it.
- `public/src/proxy.ts` gates `/`, `/control`, `/admin/**`, admin APIs, and
  mutations to broadcast state/scenes. **`/sandbox` (the internal detached
  operator console) is NOT in the matcher** — the page shell and public feed
  overlays render for anonymous visitors today (its main-scene cold start
  401s). Fix as step 0 of this work.
- `/api/auth/socket-token` already mints **receive-only guest tokens** for
  anonymous `/watch` viewers — the customer sandbox can use the live socket
  (WEATHER_RUN / CITIES_UPDATED refresh) with zero socket-server changes.
- Overlay data (alerts, quakes, cables, faults, aurora, fires, volcanoes,
  cities, manifest…) is served by public, `withCache`-wrapped feed routes —
  N sandboxes add render load only, not ingest load.
- Precedent for non-session API auth: the queue-logs route accepts an env-key
  header. The spec wants more (HMAC signature + timestamp + request-id replay
  protection); we build that properly once since hydra's connector is written
  against it.
- The internal `/sandbox` page proves the core pattern: full globe + overlay
  hooks with a **local-only `apply`** — state never emitted, never persisted
  to broadcast. The customer sandbox is the same idea with a curated panel and
  per-grant persistence.

## Architecture decisions

1. **No internal user, no cookie.** Customer access is an `EmbedGrant`
   document plus a short-lived bearer JWT held in the iframe's JS
   (`sessionStorage`). The admin session cookie is `SameSite=Lax` and would
   not survive a cross-site iframe anyway; the spec explicitly requires no
   third-party-cookie dependence.
2. **Grant = per customer+offer, not per token.** `EmbedGrant` is keyed
   unique on `(provider, externalCustomerId, offerCode)` and carries the
   customer's saved sandbox state — so their refined sandbox persists across
   visits. Each hydra mint request produces a child **bootstrap code**
   (one-use, ~60 s) against the grant, not a new grant.
3. **One-use bootstrap → bearer session.** The iframe URL carries only a
   short-lived one-use code (`/embed/sandbox?code=…`). The page redeems it
   (`POST /api/embed/redeem`) for a viewer JWT (own `actorType:
   "embed-viewer"`, TTL ≤ 4 h, capped by grant expiry) + the saved state.
   Long-lived secrets never sit in a URL where referrers/logs/history can
   leak them.
4. **Opaque codes hashed at rest; revocation is a doc flag.** Bootstrap codes
   are random 128-bit values stored as SHA-256 hashes. Grant `active:false`
   (admin button or future hydra event) kills redemption immediately and
   fails the next state write; the short viewer-JWT TTL bounds the tail.
5. **Signed integration API per spec.** `X-Hydra-Key-Id`, `X-Hydra-Timestamp`,
   `X-Hydra-Request-Id`, `X-Hydra-Signature` (HMAC over method + path +
   timestamp + request-id + body SHA-256). Reject stale timestamps (>5 min)
   and replayed request IDs. Idempotent: a replayed request ID returns the
   original response.
6. **Sanitized state, allowlisted both ways.** A `SandboxState` type — an
   explicit allowlisted subset of `ControlState` — is projected on save AND
   on load. Customers can never smuggle director/broadcast fields into Mongo
   or back out to the renderer. (Parity-test it against `ControlState` keys,
   same trick as the controlstate-persist parity test.)
7. **The broadcast is unreachable by construction.** The sandbox page never
   emits `CONTROL_STATE`/`SCENE_STATE`, its only write endpoint touches its
   own grant doc, the viewer JWT satisfies neither `isAdmin()` nor the socket
   relay's admin check, and no task/queue/admin route accepts it. (Spec
   acceptance: customer sessions cannot reach internal surfaces.)
8. **CSP `frame-ancestors` on `/embed/**` only**, from an env allowlist of
   hydra origins. The rest of the app is unaffected (OBS loads `/watch`
   top-level, not framed).

## Data model (shared/src/db)

```ts
// embed-grant-model.ts — one per customer+offer; the doc IS their sandbox
interface iEmbedGrant {
  id: string;
  provider: "hydra";                 // future-proof, single value today
  externalCustomerId: string;        // opaque hydra customer id
  externalOrderId?: string;
  sku?: string;
  offerCode: string;                 // e.g. "sandbox.standard"
  origin: string;                    // hydra origin allowed to frame/postMessage
  active: boolean;                   // revocation flag
  expiresAt: Date;                   // entitlement expiry from hydra (policy-capped)
  state?: SandboxState;              // sanitized saved sandbox state
  lastSeenAt?: Date;                 // light usage audit
  purgeAt: Date;                     // expiresAt + 30d; TTL index cleans up
}
// unique index (provider, externalCustomerId, offerCode); TTL index on purgeAt

// embed-bootstrap-model.ts — one-use launch codes, children of a grant
interface iEmbedBootstrap {
  id: string;
  grantId: string;
  requestId: string;                 // hydra X-Hydra-Request-Id — unique ix = idempotency + replay guard
  codeHash: string;                  // sha256 of the one-use code; raw code never stored
  expiresAt: Date;                   // now + 60s; TTL index
  usedAt?: Date;                     // one-use enforcement
}
```

Repos follow house style (typed Mongoose, `getModel`, tests). No blob data,
no worker involvement — public owns these reads/writes (they're trivial).

## Endpoints

Server-to-server (hydra → WeatherChannel), signature-guarded:

- `POST /api/integration/v1/embed-sessions` — body per spec
  (`hydraCustomerId`, `offerCode`, `origin`, `entitlementExpiresAt`,
  `requestId`, …). Upserts the grant (refreshing `expiresAt`/`origin`),
  creates a bootstrap, returns `{ embedUrl, expiresAt }`. Replayed
  `requestId` → the original response. Unknown `offerCode` → 422.

Browser (inside the iframe):

- `POST /api/embed/redeem` — `{ code }` → validates hash, one-use, expiry,
  grant active → `{ viewerToken, state, expiresAt }`. Marks `usedAt`.
- `GET/PATCH /api/embed/state` — `Authorization: Bearer <viewerToken>`;
  re-checks grant `active` + `expiresAt` on every call; PATCH runs the
  `SandboxState` sanitizer and a simple min-interval write guard (client
  debounces; server rejects > 1 write/2 s per grant). Updates `lastSeenAt`.

Admin:

- `/admin/embeds` — list grants (customer, offer, created, expires, last
  seen) with a Revoke button; MUI, house admin theme. Backing
  `/api/admin/embeds` routes ride the existing proxy admin gate.

## The embed page (`/embed/sandbox`)

- `public/src/app/embed/sandbox/page.tsx` + small components under
  `components/embed/` (keep files small).
- Boot flow: read `?code=` → redeem → stash viewer JWT + grantId in
  `sessionStorage` (an iframe reload inside the session TTL resumes without
  a new code) → render. No code and no stored session → friendly
  "session expired — relaunch from your account page" panel, never a login
  redirect.
- `postMessage` to parent (target = grant `origin`, origin-checked both
  ways): `ready`, `authExpired` (hydra silently re-mints and swaps the
  iframe src), `error`. Incoming messages ignored unless origin matches.
- Globe: reuse `GlobeView` + the same overlay hooks as `/sandbox`, with a
  new **`EmbedControlPanel`** — the "refined" part. v1 allowlist (product-
  tunable, mirrors `SandboxState`):
  - map type / `activeVariable` (the land map-type set), units;
  - overlay toggles: alerts (+ severity min), seismic, aurora, satellite
    imagery, fires, volcanoes, cables, faults;
  - camera, auto-spin, place search → `flyTo` (public cities API);
  - explicitly absent: director, tracks config beyond defaults, satellites
    group selection, debug, anything that enqueues work.
- Live data refresh via the existing anonymous guest socket token
  (`WEATHER_RUN`, `CITIES_UPDATED`) — receive-only, exactly like `/watch`.
- State autosave: debounced PATCH (~3 s after last change) + on
  `visibilitychange` hide.
- CSP: `frame-ancestors <EMBED_FRAME_ANCESTORS>` header on `/embed/**` via
  `next.config` headers.

## Env (root .env / .env.deploy)

```
EMBED_ENABLED=1
HYDRA_INTEGRATION_KEY_ID=hydra-main
HYDRA_INTEGRATION_SECRET=<random 32B>       # server-side both ends only
EMBED_FRAME_ANCESTORS=https://<hydra-domain>
EMBED_PUBLIC_URL=https://io.photonsurge.uk  # base for returned embedUrl
```

## Delivery phases

Each phase lands green (`./test`) with its own unit tests; shared edits
followed by `./update-shared`.

**Phase 0 — hygiene (tiny, do first)**
- ~~Add `/sandbox` to the proxy matcher + `needsAdmin` (internal console goes
  admin-only; test in `proxy.test.ts`).~~ **DONE Aug 2026** — shipped ahead
  of the shelved plan since it was a standalone gating gap.
- Env plumbing + `EMBED_ENABLED` kill-switch.

**Phase 1 — shared foundations**
- `embed-grant-model/repo`, `embed-bootstrap-model/repo` (+ indexes, TTL).
- `shared/src/embed-sandbox-state.ts` — `SandboxState` type + sanitizer +
  parity test against `ControlState` keys.
- `shared/src/utill/viewer-session.ts` — sign/read viewer JWTs
  (`actorType: "embed-viewer"`); prove `isAdmin()` and `readSession()`
  reject them.
- `shared/src/utill/hydra-signature.ts` — canonical string + HMAC verify;
  publish test vectors (the spec's contract-test requirement — hydra's
  connector tests reuse them).

**Phase 2 — integration API + admin**
- `POST /api/integration/v1/embed-sessions`: signature, timestamp window,
  request-id idempotency/replay, offer allowlist, grant upsert, bootstrap
  mint. Tests: bad signature, stale timestamp, replay, unknown offer, happy
  path, idempotent repeat.
- `/admin/embeds` list + revoke.

**Phase 3 — embed shell**
- Redeem route (one-use, expiry, revoked, unknown-code paths tested).
- `/embed/sandbox` boot flow + error panels + postMessage handshake (RTL
  tests for redeem-success / expired / revoked states).
- `frame-ancestors` header on `/embed/**`.

**Phase 4 — the refined sandbox**
- `EmbedControlPanel` + globe wiring (reuse hooks; factor anything shared
  with `/sandbox` into small common components rather than duplicating).
- State restore on redeem, debounced autosave, server write guard,
  `lastSeenAt`.

**Phase 5 — hardening + hydra handoff**
- Minimal `POST /api/integration/v1/hydra/events` accepting
  `entitlement.revoked`/`entitlement.suspended` → grant `active:false`
  (idempotent by event ID). Full lifecycle vocabulary can wait.
- Contract fixtures doc for the hydra connector (request/response JSON +
  signature vectors), so the hydra side is written against files, not vibes.
- Manual pass: mint via curl, embed in a local hydra page, expiry/revoke
  behaviour, iframe reload, second device.

## Out of scope (later levels)

Public marketing links (L0), share links (L1), device pairing/QR (L3),
custom published feeds (L4), quotas/abuse dashboards beyond the write guard,
and the internal RBAC overhaul. The grant/bootstrap/signature plumbing built
here is the substrate all of those reuse.

## Open questions (product, not blocking)

- Offer codes for v1 — a single `sandbox.standard` seems right until hydra
  sells tiers.
- Grant expiry policy cap (spec passes `entitlementExpiresAt`; suggest
  capping at 400 d and treating "no expiry" as subscription-renewed via
  future events).
- Whether the sandbox shows the "SELECTED" click-card + forecast strip from
  the internal sandbox in v1 (cheap to include — it's all public data — and
  makes the product feel alive; recommend yes).
