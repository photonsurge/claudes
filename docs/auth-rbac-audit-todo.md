# Authentication, RBAC, and User Audit TODO

## Goal

Replace the current single-admin authorization model with four roles (`root`,
`admin`, `staff`, and `user`), enforce permissions on the server, and keep a
durable audit trail of every authenticated user action.

The most important invariant is: **only `root` may trigger a task/job**. Hiding
a button is not authorization; every task-triggering API route must reject all
other roles.

## Role and permission matrix

| Capability | root | admin | staff | user |
| --- | --- | --- | --- | --- |
| Sign in and sign out | Yes | Yes | Yes | Yes |
| View permitted application content | Yes | Yes | Yes | Yes |
| View admin/operator dashboards | Yes | Yes | Limited | No |
| View and update editorial/content data | Yes | Yes | Yes | No |
| Use broadcast/control mutations | Yes | Yes | Only if explicitly granted | No |
| List users | Yes | Yes | No | No |
| Create, edit, disable, or reset users | Yes | Yes, subject to hierarchy below | No | No |
| Assign the `root` role | Yes | No | No | No |
| Modify or disable a root account | Yes | No | No | No |
| View the task/job screen or queue state | Yes | No | No | No |
| Trigger any manual task/job | Yes | No | No | No |
| View the user audit log | Yes | Yes | No | No |

Role hierarchy for user management:

- `root` may manage any account, but the system must prevent removal or
  disabling of the final active root account.
- `admin` may create and manage only `admin`, `staff`, and `user` accounts.
  An admin cannot create, promote, edit, disable, or reset a root account.
- `staff` and `user` have no user-management access.
- A user must not be able to promote their own account or bypass hierarchy by
  submitting a role directly to an API.

## Phase 1 — Centralize roles and authorization

- [ ] Replace free-form role strings with a shared `UserRole` type and schema
  validation for exactly `root | admin | staff | user` in
  `shared/src/db/user-model.ts`.
- [ ] Decide how the first root account is bootstrapped (recommended: an
  idempotent deployment/CLI command using environment-provided credentials;
  never a public HTTP endpoint).
- [ ] Migrate existing `admin` users without changing their current access.
  Create the initial root explicitly before enabling root-only restrictions.
- [ ] Add a central permission map and helpers such as `hasPermission`,
  `requireSession`, and `requirePermission`. Avoid scattered comparisons such
  as `session.role === "admin"`.
- [ ] Define named permissions, at minimum:
  `content:read`, `content:write`, `control:read`, `control:write`,
  `users:read`, `users:write`, `tasks:read`, `tasks:trigger`, and
  `audit:read`.
- [ ] Update session validation so only known roles are accepted. Decide how to
  invalidate sessions promptly after a role change or account disable
  (recommended: session/version field checked against the user record on
  privileged requests).
- [ ] Rename or retire `isAdmin()` in `shared/src/utill/session.ts`; add tests
  for all four roles and every permission.

## Phase 2 — Enforce permissions at API boundaries

- [ ] Add reusable route guards that return `401` for no/invalid session and
  `403` for an authenticated user lacking permission.
- [ ] Refactor `public/src/proxy.ts` to perform broad authentication/page
  routing only. Treat API route permission checks as authoritative.
- [ ] Inventory every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) and
  assign an explicit named permission. Routes without an assignment should
  fail closed.
- [ ] Protect user APIs: listing requires `users:read`; creation, role changes,
  password resets, and enable/disable actions require `users:write` plus the
  role-hierarchy checks above.
- [ ] Protect editorial/content mutation routes with `content:write`, allowing
  `root`, `admin`, and `staff`.
- [ ] Separate content editing from operational actions. A route that both
  edits content and queues work must be split, or its queueing operation must
  require `tasks:trigger`.
- [ ] Require `tasks:read` on `GET /api/admin/jobs` and `tasks:trigger` on
  `POST /api/admin/jobs`.
- [ ] Find every other queue/task entry point—including country, region,
  volcano, enrichment, refresh, seed, snapshot, summary, track, and control
  actions—and require `tasks:trigger` for each one.
- [ ] Never trust client-provided actor, role, or trigger fields. Derive actor
  identity from the verified session and record task payloads as
  `trigger: "user"` plus the authenticated actor ID.
- [ ] Review socket-token role propagation and socket event handlers. Enforce
  permissions on the server receiving each socket mutation, not only when the
  token is minted.

## Phase 3 — Navigation and role-specific UI

- [ ] Expose the authenticated user's role/permissions to server-rendered admin
  pages through a safe session/view model.
- [ ] Give `staff` a limited operator area containing view and content-edit
  screens only.
- [ ] Hide user management, task/job navigation, queue counts, and task trigger
  controls from staff and users. Admins may see user management and audit, but
  must not see tasks.
- [ ] Show task/job screens and trigger buttons only to root.
- [ ] Add a proper unauthorized page/message for authenticated users who open
  a disallowed URL; do not redirect them to login as if logged out.
- [ ] Treat UI visibility as convenience only; retain all API enforcement.

## Phase 4 — Durable user audit trail

- [ ] Create a dedicated audit-event model instead of relying on the current
  short-lived operational `Log` model. Audit records must not use the default
  seven-day TTL.
- [ ] Store at least: event ID, timestamp, actor user ID, actor email snapshot,
  actor role snapshot, action name, resource type, resource ID, outcome
  (`success | denied | failure`), request ID/correlation ID, source IP (with
  the agreed proxy-trust policy), user agent, and redacted structured metadata.
- [ ] Make audit events append-only through the application. Do not expose
  update/delete endpoints.
- [ ] Define retention and access policy before launch. Recommended baseline:
  at least 12 months, with access limited to `root` and `admin`.
- [ ] Add a shared `auditAction()` helper and wrap authenticated route handlers
  so successful actions, denied attempts, validation failures, and operational
  failures are captured consistently.
- [ ] Audit authentication events: login success/failure, logout, expired or
  invalid session use, and disabled-account attempts. Never log passwords,
  password hashes, session cookies, JWTs, secrets, or full sensitive payloads.
- [ ] Audit all authenticated reads and writes. Use stable action names such as
  `user.list`, `user.create`, `content.update`, `task.view`, and
  `task.trigger` rather than prose messages.
- [ ] For high-volume passive reads, confirm storage impact and apply a clear
  policy (for example one event per API request, not every browser asset).
- [ ] Ensure task audit events include the queue job ID, registered task ID,
  sanitized parameters, and enqueue outcome.
- [ ] Build an audit viewer with date, actor, role, action, resource, and outcome
  filters. It must not be backed by the existing transient log-tail endpoint.
- [ ] Decide failure behavior: authorization and sensitive mutations should not
  silently proceed if their required audit event cannot be persisted. Document
  any availability trade-off and monitor audit-write failures.

## Phase 5 — Tests and rollout

- [ ] Add table-driven unit tests covering every role against every permission.
- [ ] Add integration tests proving staff can view/update content but cannot
  list/manage users, see tasks, inspect queue counts, or trigger any job.
- [ ] Add integration tests proving admin can manage non-root users and view
  audit events, but cannot see or trigger tasks or affect root accounts.
- [ ] Add integration tests proving user is limited to normal user-facing
  access.
- [ ] Add integration tests proving only root can view task state and trigger
  every registered task endpoint, including direct API calls with forged role
  fields.
- [ ] Test inactive users, stale sessions after role changes, last-root
  protection, self-promotion attempts, socket mutations, and watch-token flows.
- [ ] Test that audit records are emitted for success, denial, validation
  failure, and internal failure, and that secrets are redacted.
- [ ] Add a route-permission inventory test or lintable registry so new admin
  and mutating routes cannot ship without an explicit permission and audit
  action.
- [ ] Roll out in stages: deploy schema/helpers, bootstrap root, verify root
  login, enable endpoint guards, then expose role-specific UI.
- [ ] Before release, manually verify with one account of each role and inspect
  the resulting audit trail.

## Acceptance criteria

- [ ] Every account has exactly one validated role: root, admin, staff, or user.
- [ ] Direct HTTP/socket calls cannot bypass role restrictions.
- [ ] Staff can view and update approved content but cannot manage users or see
  any task/job surface.
- [ ] Admin can manage only non-root users and cannot view or trigger tasks.
- [ ] Only root can view task/queue details or trigger any manual task.
- [ ] Every authenticated application action produces a searchable,
  actor-attributed audit event with an outcome, without leaking secrets.
- [ ] Disabling an account or changing its role takes effect for existing
  sessions within the documented revocation window.
- [ ] The final active root cannot be demoted or disabled.

