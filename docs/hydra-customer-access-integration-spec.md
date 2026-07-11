# Hydra Customer Access Integration Specification

## Purpose

Hydra is the business website, ecommerce platform, and CMS. WeatherChannel is
the weather application and remains the system of record for feeds, scenes,
weather data, customer feed configurations, viewing sessions, and viewer audit
history.

Hydra's integration responsibility is deliberately narrow:

1. sell or grant a product;
2. authenticate the customer where authentication is required;
3. tell WeatherChannel which customer and product are involved through a
   signed server-to-server request; and
4. present the URL or iframe returned by WeatherChannel.

Hydra must not become a weather-map application and must not copy, model, edit,
or serve WeatherChannel data.

## Data ownership boundary

| Data | System of record | What Hydra may retain |
| --- | --- | --- |
| Products, prices, orders, subscriptions, invoices | Hydra | Full business record |
| Hydra customer identity and login | Hydra | Full business record |
| Product-to-access-offer mapping | Hydra | WeatherChannel `offerCode` only |
| Weather feeds, scenes, layers, regions, alerts, forecasts | WeatherChannel | No copy; optional display title/marketing image maintained independently in CMS |
| Feed publication and availability | WeatherChannel | No copy or cached authorization decision |
| Viewer entitlements | WeatherChannel, derived from signed Hydra events | Hydra keeps its originating order/subscription |
| Embed and viewing tokens | WeatherChannel | Hydra may relay a one-use code but must not persist it |
| Customer custom-feed configuration | WeatherChannel | No copy |
| Viewer devices and active sessions | WeatherChannel | No copy |
| Weather viewing/audit history | WeatherChannel | No copy |

Hydra references commercial offers with opaque codes such as `watch.global`,
`watch.all`, `watch.mobile`, or `custom-feed.standard`. It does not store feed
IDs, layer settings, map state, or scene configuration unless a future contract
explicitly requires one opaque WeatherChannel resource ID.

## Integration levels

The integration is progressive. A product may use the simplest level that
meets its needs.

### Level 0 — Public link

Example: a CMS button opens a free public WeatherChannel page.

Hydra must support:

- A normal CMS link field.
- Optional campaign parameters such as `utm_source=hydra`.
- Opening in the same tab or a new tab.
- No customer, order, or weather data exchange.

WeatherChannel must support:

- A deliberately public route such as `/watch/public/:slug`.
- A publication flag and safe public feed allowlist.
- No reuse of internal scene watch tokens.
- Public rate limits and ordinary anonymous analytics/auditing.

Security properties:

- Anybody with the URL can watch.
- The URL grants no paid entitlement and contains no secret.
- Hydra has no availability or authorization responsibility.

Use for free marketing feeds only.

### Level 1 — Share/watch token link

Example: Hydra displays a WeatherChannel-generated event link that is valid
until a particular date.

Hydra must support:

- A CMS/product field containing an opaque WeatherChannel share link or share
  code.
- Treating the value as a secret: do not expose it in analytics payloads,
  referrer metadata, logs, page source before purchase, or search indexing.
- Optional expiry display supplied as business copy; WeatherChannel remains
  authoritative for actual expiry.
- Revocation by replacing/removing the link in Hydra when instructed.

WeatherChannel must support:

- Creation and revocation of hashed share tokens.
- Scope to one published feed or a fixed feed bundle.
- Expiry, maximum concurrent viewers, optional total-use limits, and audit.
- A token exchange so the long token is removed from the browser URL and
  replaced with a short viewer session.
- A safe error page for expired/revoked links.

Security properties:

- This is bearer access: anyone who receives the link may use it.
- It identifies the link or campaign, not an individual customer.
- It is unsuitable for personal custom feeds or high-value subscriptions.

### Level 2 — Purchased web viewing in a Hydra iframe

Example: a customer buys a product and watches an entitled feed inside the
Hydra product/account page.

Hydra must support:

- Authenticated customer and order/subscription checks.
- A server-side WeatherChannel integration client. The integration secret must
  never reach the browser.
- `POST /integration/v1/embed-sessions` on WeatherChannel using a signed
  request.
- Passing only:
  - stable opaque `hydraCustomerId`;
  - `hydraOrderId` or `hydraSubscriptionId`;
  - Hydra product SKU;
  - configured `offerCode`;
  - Hydra entitlement expiry, if applicable;
  - intended return/origin domain;
  - a unique request ID and timestamp.
- Rendering the returned one-use `embedUrl` in an iframe.
- Handling `postMessage` events for ready, resize, authentication expired,
  access denied, and fatal error. Every message must be origin-checked.
- Re-requesting a session after expiry rather than storing/reusing an old URL.

Hydra does not need:

- A WeatherChannel feed catalogue.
- Knowledge of feed IDs, layers, regions, or map configuration.
- Weather APIs or WeatherChannel database access.
- A copy of the viewing token or entitlement record.

WeatherChannel must support:

- Verification of Hydra request signatures, timestamps, nonce/request IDs, and
  allowed Hydra origins.
- Idempotent embed-session creation.
- Mapping `offerCode` to currently published WeatherChannel resources.
- A one-use bootstrap code with a lifetime of roughly 30–60 seconds.
- Exchange of that code for a short-lived, audience-bound viewer session.
- `Content-Security-Policy: frame-ancestors` restricted to approved Hydra
  storefront domains.
- Entitlement, expiry, concurrency, and revocation enforcement on every
  protected request/socket connection.
- A responsive viewer that does not depend on third-party cookies.

Recommended Hydra request:

```json
{
  "hydraCustomerId": "cus_opaque_123",
  "hydraOrderId": "ord_opaque_456",
  "sku": "WEATHER-ALL-MONTHLY",
  "offerCode": "watch.all",
  "entitlementExpiresAt": "2026-08-11T12:00:00Z",
  "origin": "https://shop.example.com",
  "requestId": "01J...",
  "requestedAt": "2026-07-11T12:00:00Z"
}
```

Recommended WeatherChannel response:

```json
{
  "embedUrl": "https://weather.example.com/embed/bootstrap?code=ONE_USE_CODE",
  "expiresAt": "2026-07-11T12:01:00Z"
}
```

The response deliberately contains no weather/feed data.

### Level 3 — Watch on phone or another device

Example: a purchase occurs on Hydra desktop, but the customer wants to watch
on their phone, television browser, or another device.

Hydra must support:

- A “Watch on another device” action on the entitled product/account page.
- A server-side request to WeatherChannel to create a device-pairing session.
- Rendering the returned QR code or short URL and human-readable pairing code.
- Never generating QR codes from a durable viewer token itself.
- Optional display of pairing expiry and retry state.
- No device registry or active-device state in Hydra.

WeatherChannel must support:

- `POST /integration/v1/device-pairings` authenticated by Hydra's signed
  server-to-server credentials.
- A single-use pairing code with a short lifetime, recommended 5 minutes.
- A mobile route such as `/pair/:code` that exchanges the code for a
  device-bound viewer session.
- Optional confirmation in the original iframe/browser before pairing a new
  device for higher-value products.
- Device/session listing, revocation, concurrency limits, and “sign out all
  devices” within WeatherChannel.
- Mobile-first playback and custom-feed UI.
- Protection against code guessing, replay, screenshots used after redemption,
  and unlimited device creation.

Hydra request adds no device details; it sends the same customer/order/offer
identity used for web viewing. WeatherChannel owns the resulting device ID,
session, IP, user agent, and viewing history.

Possible pairing response:

```json
{
  "pairingUrl": "https://weather.example.com/pair/ABCD-EFGH",
  "pairingCode": "ABCD-EFGH",
  "qrPayload": "https://weather.example.com/pair/ABCD-EFGH",
  "expiresAt": "2026-07-11T12:05:00Z"
}
```

The phone does not need a Hydra cookie. Successful possession and exchange of
the short-lived pairing code creates a WeatherChannel viewer session scoped to
the purchased entitlement.

### Level 4 — Customer-owned custom feed

Example: a customer buys a custom-feed product and configures regions, layers,
presentation, and rotation inside WeatherChannel.

Hydra must support:

- Selling a custom-feed SKU/subscription.
- Mapping that SKU to an opaque offer such as `custom-feed.standard`.
- Launching WeatherChannel through the Level 2 embed-session contract.
- Passing the stable Hydra customer ID so WeatherChannel can consistently find
  that customer's entitlement and owned feed records.
- Subscription lifecycle webhooks so WeatherChannel can suspend or restore
  editing/viewing rights.
- Displaying business/account actions such as renew, upgrade, cancel, and
  invoice history.

Hydra must not support:

- Custom-feed fields or editors in its CMS.
- Weather layer/region catalogues.
- Feed configuration validation.
- Saving drafts, map positions, schedules, or presentation state.
- Calling worker/job/task APIs.

WeatherChannel must support:

- Customer identity links keyed by provider plus opaque external ID, for
  example `{ provider: "hydra", externalCustomerId }`.
- Customer entitlements derived from signed Hydra requests/events.
- Customer-owned feed records and ownership checks on every operation.
- An allowlisted editor for regions, layers, timing, layout, and other safe
  options.
- Draft, preview, publish, duplicate, and delete operations subject to product
  quotas.
- Validation and hard resource limits.
- Phone/device access to the same owned feeds.
- Audit records for configuration and viewing actions.
- Separation from internal scenes, broadcast control, queues, and admin tasks.

If generating a preview requires asynchronous work, WeatherChannel owns a
restricted customer-preview workflow. Hydra never invokes the internal task
queue. Internal manual task triggering remains `root`-only.

### Level 5 — Customer sandbox

Example: a customer experiments with permitted WeatherChannel configuration
before publishing a custom feed.

Hydra support is identical to Level 4: sell the product and launch the returned
WeatherChannel URL/iframe. Hydra does not implement the sandbox.

WeatherChannel must support:

- Isolated drafts that cannot alter production/internal scenes.
- Approved configuration values only.
- Per-entitlement quotas for saved drafts, preview time, API frequency,
  concurrent previews, and expensive operations.
- Automatic expiry/cleanup of temporary resources.
- Sanitized imports/exports if offered.
- No access to users, audit administration, content administration, raw
  databases, tasks, queues, worker controls, or unpublished feeds.
- Abuse monitoring and per-customer suspension.

Sandbox is a product capability/entitlement, not an internal staff role.

## Hydra integration capabilities

Hydra needs one small WeatherChannel connector with the following features.

### Configuration

- WeatherChannel integration base URL.
- Hydra integration key ID.
- Signing secret or private key stored only in Hydra's server-side secret
  store.
- Allowed Hydra storefront origins.
- SKU-to-`offerCode` mappings.
- Request timeout and retry policy.

### Request signing

Recommended minimum headers:

```text
X-Hydra-Key-Id
X-Hydra-Timestamp
X-Hydra-Request-Id
X-Hydra-Signature
```

Sign the HTTP method, canonical path, timestamp, request ID, and SHA-256 body
hash. WeatherChannel rejects old timestamps and reused request IDs. Prefer
asymmetric signing if multiple Hydra deployments must call WeatherChannel;
otherwise rotated HMAC keys are acceptable.

### Product launch component

The Hydra CMS/ecommerce UI needs a generic protected-application product block,
not a weather-specific component. Configuration consists of:

- integration name (`weather-channel`);
- `offerCode`;
- launch mode (`link`, `iframe`, or `new-window`);
- whether device pairing is shown;
- marketing copy and imagery owned by Hydra.

At render/launch time, Hydra verifies its own customer purchase and requests a
fresh launch session. It does not build the WeatherChannel destination itself.

### Lifecycle webhooks

Hydra sends signed, idempotent events to
`POST /integration/v1/hydra/events`:

- `entitlement.granted`
- `entitlement.renewed`
- `entitlement.suspended`
- `entitlement.revoked`
- `order.refunded`
- `subscription.expired`

Each event contains only opaque customer/order/subscription identifiers, SKU,
`offerCode`, effective time, expiry, event ID, and event time. Do not send
payment cards, addresses, passwords, invoices, or unrelated customer profile
data.

WeatherChannel stores the event ID for idempotency and immediately applies
revocation/suspension to web, phone, and custom-feed sessions.

### Error handling

Hydra should translate connector failures into business-safe states:

- `401/403` from WeatherChannel connector: integration configuration problem;
  do not retry indefinitely.
- `409`: duplicate/idempotent request; consume the original result if returned.
- `422`: invalid SKU/offer/customer state; show access unavailable and alert
  operations.
- `429`: obey `Retry-After`.
- `5xx/timeout`: bounded retry with the same request ID, then show a temporary
  unavailable message.

Hydra logs request ID, status, duration, and integration name. It must not log
signatures, bootstrap codes, pairing codes, embed URLs, or viewer tokens.

## WeatherChannel identity and entitlement model

Hydra customers are external identities, not internal WeatherChannel users.
They must not be assigned `root`, `admin`, `staff`, or the internal `user`
role. Use a separate customer/viewer domain:

```ts
interface ExternalCustomerIdentity {
  id: string;
  provider: "hydra";
  externalCustomerId: string;
  active: boolean;
}

interface CustomerEntitlement {
  id: string;
  customerIdentityId: string;
  externalOrderId?: string;
  externalSubscriptionId?: string;
  sku: string;
  offerCode: string;
  status: "active" | "suspended" | "revoked" | "expired";
  startsAt: Date;
  expiresAt?: Date;
}
```

This keeps internal workforce authorization independent from commercial
customer access.

## Required WeatherChannel endpoints

Server-to-server endpoints called by Hydra:

```text
POST /integration/v1/embed-sessions
POST /integration/v1/device-pairings
POST /integration/v1/hydra/events
```

Browser endpoints owned entirely by WeatherChannel:

```text
GET  /embed/bootstrap?code=...
GET  /pair/:code
GET  /viewer/feeds
GET  /viewer/feeds/:id
GET  /viewer/custom-feeds
POST /viewer/custom-feeds
PATCH /viewer/custom-feeds/:id
DELETE /viewer/custom-feeds/:id
POST /viewer/custom-feeds/:id/preview
POST /viewer/sessions/logout
POST /viewer/sessions/logout-all
```

The exact internal paths may use the existing Next.js `/api` convention, but
the ownership boundary and behavior should remain the same.

## Testing responsibilities

Hydra unit tests:

- Canonical signing and signature headers.
- SKU-to-offer mapping.
- Customer/order/subscription validation before launch.
- Fresh embed session requested on every launch.
- Returned URLs relayed without persistence or logging.
- Error/status mapping and bounded idempotent retry.
- Strict `postMessage` origin validation.
- Webhook payload contains only allowed fields.

WeatherChannel unit/integration tests:

- Signature, timestamp, request-ID replay, and origin validation.
- Offer mapping and publication checks.
- One-use bootstrap and pairing-code redemption.
- Entitlement expiry/revocation across web and phone sessions.
- Concurrent-device limits.
- Custom-feed ownership and quota checks.
- Sandbox isolation and task/queue denial.
- Secret/token redaction in all logs and audit records.
- Hydra customer sessions cannot access internal admin APIs.

Contract tests shared between systems:

- Versioned request/response fixtures for embed sessions, pairings, and events.
- Signature test vectors.
- Idempotency and retry behavior.
- Backward-compatible additive changes within `v1`.
- Rejection of unknown required values and malformed timestamps.

## Recommended delivery order

1. Public links for deliberately free feeds.
2. Expiring share links for low-risk campaigns.
3. Signed Hydra connector and purchased iframe viewing.
4. Signed entitlement lifecycle events and immediate revocation.
5. Phone/device pairing.
6. WeatherChannel-owned custom feeds.
7. WeatherChannel-owned sandbox and restricted preview processing.

Do not begin custom feeds or sandbox work by adding weather models to Hydra.
Those tiers extend WeatherChannel; Hydra continues to use the same generic
commerce launch connector.

## Acceptance criteria

- Hydra can sell and launch every access tier without storing weather/feed
  configuration or viewer-session data.
- No permanent secret or viewer token is exposed to the browser or persisted by
  Hydra.
- Web, phone, custom-feed, and sandbox access stops when WeatherChannel applies
  a Hydra suspension/revocation event.
- A Hydra customer can access only the offers and custom feeds owned by their
  external identity.
- Customer sessions cannot access internal admin, user-management, audit,
  task, queue, worker, or broadcast-control surfaces.
- Internal manual tasks remain root-only; Hydra never calls them.
- Custom feed and sandbox data remain entirely in WeatherChannel.
- Both systems can correlate a launch or failure by request ID without sharing
  sensitive application data.

