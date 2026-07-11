# Authentication, RBAC, and Audit Implementation Plan

This is the delivery plan for
[`auth-rbac-audit-todo.md`](./auth-rbac-audit-todo.md). Implement it in the
order below so the application never reaches a state where task triggers are
unprotected or all administrators are locked out.

## Fixed product decisions

- Roles are `root`, `admin`, `staff`, and `user`.
- `root` is the only role allowed to see task/queue details or trigger work.
- `admin` manages non-root users and can view the audit log.
- `staff` can view operator data and edit approved content, but cannot manage
  users, view tasks, or trigger work.
- `user` has no admin/operator access.
- Permissions are enforced at the API/socket handler, not just in middleware or
  the UI.
- Authenticated application requests are audited. Static assets, health checks,
  and anonymous public data fetches are not user actions and are excluded.

## Target authorization design

Add `shared/src/auth/roles.ts` as the source of truth:

```ts
type UserRole = "root" | "admin" | "staff" | "user";

type Permission =
  | "content:read"
  | "content:write"
  | "control:read"
  | "control:write"
  | "users:read"
  | "users:write"
  | "tasks:read"
  | "tasks:trigger"
  | "audit:read";
```

Use one immutable role-to-permission map and expose `hasPermission(role,
permission)`. Add server-only helpers under `public/src/lib/server/auth.ts`:

- `getRequestActor()` validates the cookie, reloads the user, checks `active`
  and session version, then returns a safe actor.
- `requireActor()` distinguishes unauthenticated (`401`) from unauthorized
  (`403`).
- `requirePermission(permission)` is the normal API guard.
- `canManageUser(actor, targetRole, operation)` enforces the role hierarchy.

`proxy.ts` remains a page/authentication convenience. It must not be the only
guard for an API.

## Delivery slice 1 — Roles and permission unit tests

Files:

- Modify `shared/src/db/user-model.ts`.
- Add `shared/src/auth/roles.ts`.
- Add `shared/src/auth/roles.test.ts`.
- Update `shared/src/db/user-repo.ts` and its tests.

Work:

1. Expand `ALLOWED_ROLES` to all four roles and make `iUser.role` a
   `UserRole`, not `string`.
2. Add a Mongoose enum validator. Keep the database default as `admin` during
   migration compatibility; new HTTP-created users will choose an explicit
   role.
3. Add `sessionVersion: number`, default `1`, to users. Increment it when role,
   active state, or password changes.
4. Add typed repository methods for role updates, account activation, counting
   active roots, and safe conditional root changes.
5. Implement and exhaustively test the permission matrix.

Gate: shared typecheck and unit tests pass; existing admin records remain valid.

## Delivery slice 2 — Session validation and request guards

Files:

- Modify `shared/src/utill/session.ts` and tests.
- Add `public/src/lib/server/auth.ts` and tests.
- Modify login and socket-token routes under `public/src/app/api/auth/`.

Work:

1. Put `sessionVersion` in new session JWTs and reject unknown roles.
2. On privileged HTTP requests, reload the actor by `sub`; reject missing or
   inactive accounts and version mismatches.
3. Return a typed safe actor `{ id, email, role }`, never the user document or
   password hash.
4. Make login issue the new session format and logout remain idempotent.
5. Mint socket tokens from the revalidated actor. Preserve anonymous socket
   behavior where the public application requires it, but do not grant an
   anonymous actor any mutation permission.

Gate: tests cover bad JWTs, deleted/disabled users, stale versions, all roles,
and correct `401`/`403` behavior.

## Delivery slice 3 — Bootstrap the first root safely

Files:

- Add a script such as `worker/src/scripts/bootstrapRoot.ts` (or a shared CLI
  entry if that better matches the repository's script conventions).
- Add the command to the owning package's `package.json`.
- Document required variables in `.env.sample` without real credentials.

Work:

1. Accept root email/password from environment or interactive deployment
   input, hash the password with the existing password helper, and never print
   it.
2. Make the command idempotent by email. If the user already exists, require an
   explicit promotion flag rather than silently changing the role.
3. Refuse to run when required secrets are absent or the password policy fails.
4. Audit/log only the bootstrap outcome and user ID/email, never credentials.
5. Run this in the deployment environment before enabling root-only routes.

Gate: a root can log in before task authorization changes are deployed.

## Delivery slice 4 — Dedicated append-only audit storage

Files:

- Add `shared/src/db/audit-event-model.ts`.
- Add `shared/src/db/audit-event-repo.ts` and tests.
- Register the repository in `shared/src/db/index.ts`.
- Add `public/src/lib/server/audit.ts` and tests.

Audit record shape:

- `id`, `timestamp`, `requestId`
- `actorId`, `actorEmail`, `actorRole`
- `action`, `resourceType`, `resourceId`
- `outcome: success | denied | failure`
- `ip`, `userAgent`
- redacted JSON-safe `metadata`

Work:

1. Use a separate Mongo collection with indexes for newest-first queries,
   actor, action, resource, and outcome. Do not inherit the seven-day TTL from
   `log-model.ts`.
2. Centralize redaction and maximum metadata size. Drop keys matching password,
   token, cookie, authorization, secret, and hash.
3. Add a helper that writes one event per authenticated API action and supports
   success, denial, validation failure, and internal failure.
4. Generate or propagate `x-request-id`. Only trust forwarded IP headers when
   the deployment's trusted-proxy setting is enabled.
5. Initially make failed audit writes fail closed for user management and task
   triggers. For read-only actions, report/monitor the audit failure without
   turning every read outage into an application outage.

Gate: repository/helper tests prove append-only behavior, querying, redaction,
and the failure policy.

## Delivery slice 5 — Lock down tasks first

Files and surfaces:

- `public/src/app/api/admin/jobs/route.ts`
- `public/src/app/api/admin/queue/route.ts`
- Any endpoint that calls `sendToQueue`, `getQueue`, or a trigger/enrichment
  helper.
- Socket handlers that enqueue or cause worker activity.

Work:

1. Build a repository-wide inventory with searches for `sendToQueue`,
   `getQueue`, `.add(`, `trigger`, `seed`, `enrich`, `refresh`, `snapshot`, and
   task-like socket events.
2. Require `tasks:read` for queue/job state and `tasks:trigger` before parsing
   or enqueuing task payloads.
3. Root-gate every task-like operation, including buttons embedded outside
   `/admin/jobs` (countries, regions, volcanoes, summaries, tracks, etc.).
4. Derive `actorId` from the session. Replace the current generic
   `{ trigger: "admin" }` marker with authenticated provenance.
5. Audit denied and successful triggers. Record the task registry ID, sanitized
   input, returned queue job ID, and outcome.
6. Remove task links/buttons for non-root roles, but retain server guards.

Gate: integration tests call every identified task endpoint as all four roles;
only root receives success. Admin and staff cannot retrieve queue counts.

## Delivery slice 6 — User management and hierarchy

Files:

- Extend `public/src/app/api/admin/users/route.ts`.
- Add `public/src/app/api/admin/users/[id]/route.ts` if updates remain RESTful.
- Modify `public/src/app/admin/users/page.tsx`.

Work:

1. Guard list with `users:read` and all mutations with `users:write`.
2. Add create, role update, password reset, activate, and deactivate operations.
3. Validate the target role using shared types and enforce:
   root can manage all roles; admin can manage only admin/staff/user; nobody
   can remove the last active root.
4. Prevent self-promotion and apply explicit rules to self-disable/demotion.
5. Increment `sessionVersion` for security-sensitive changes.
6. Audit the action and changed field names, but never password material.
7. Make role choices in the UI actor-aware; do not show `root` to admins.

Gate: integration tests cover forged root role input, admin targeting root,
last-root protection, stale-session revocation, and successful normal changes.

## Delivery slice 7 — Classify and guard all remaining routes

Create a checked-in route inventory at
`docs/auth-route-permission-inventory.md`. For every API route, record methods,
anonymous/authenticated status, permission, audit action, and task-producing
behavior.

Classification rules:

- Admin content reads: `content:read`.
- Admin content edits/images/ads/cams/alerts/sea-points/notable:
  `content:write` unless they enqueue work, in which case split the endpoint or
  require `tasks:trigger` for that operation.
- Broadcast/director/scene reads and mutations: explicit `control:read` or
  `control:write`; retain documented watch-token read paths.
- User and audit surfaces: `users:*` and `audit:read`.
- Operational logs/runs/database diagnostics: explicitly decide `admin` versus
  root; do not let them inherit accidental access from `/api/admin/*`.

Update `public/src/proxy.ts` after the inventory so page routing matches the
same policy, including a `403` page for authenticated users.

Gate: every non-public route has an API guard and stable audit action. Add a
test/registry check that fails when a new route lacks classification.

## Delivery slice 8 — Role-aware application UI

Files:

- `public/src/app/admin/layout.tsx`
- Admin landing/navigation components and each privileged page.
- Add `public/src/app/forbidden/page.tsx` if no equivalent exists.

Work:

1. Display email and role in the admin header.
2. Render navigation from permissions rather than repeated role comparisons.
3. Root sees tasks, queue state, users, audit, content, and control.
4. Admin sees users, audit, content, and allowed control—but no task surfaces.
5. Staff sees approved read/content-edit surfaces only.
6. User is redirected away from the operator application with a clear `403`,
   not sent back to login.
7. Treat hidden navigation as UX only; API authorization remains definitive.

Gate: component/e2e tests verify navigation and direct-URL behavior for each
role.

## Delivery slice 9 — Audit viewer and operational readiness

Files:

- Add `public/src/app/api/admin/audit/route.ts`.
- Add `public/src/app/admin/audit/page.tsx` and components.
- Add retention/index documentation to operations docs.

Work:

1. Require `audit:read`; paginate newest-first with bounded page size.
2. Filter by date, actor, role, action, resource, and outcome.
3. Return only sanitized metadata and never provide update/delete operations.
4. Add metrics/alerts for audit-write failures and spikes in denied actions.
5. Agree the retention period (baseline: 12 months), storage estimate, backup,
   and export/legal requirements before production rollout.

Gate: root/admin can search audit events; staff/user receive `403`; indexes are
used for common queries.

## Recommended commit/PR order

1. `auth: define roles and permissions`
2. `auth: validate sessions against active users`
3. `ops: add root bootstrap command`
4. `audit: add append-only user action events`
5. `auth: restrict all task operations to root`
6. `auth: enforce user-management hierarchy`
7. `auth: classify and guard remaining API routes`
8. `ui: render operator surfaces by permission`
9. `audit: add searchable audit viewer`

Each change should be independently deployable, with the root bootstrap run
between steps 3 and 5.

## Final release checklist

- [ ] Create two root accounts held by separate authorized operators.
- [ ] Verify login and session revocation for every role.
- [ ] Run the route inventory test and full unit/integration suite.
- [ ] Attempt every task operation directly over HTTP as admin, staff, and user;
  all must return `403` and create denied audit events.
- [ ] Confirm admin cannot list task state or target a root account.
- [ ] Confirm staff can edit approved content and cannot access users/audit/tasks.
- [ ] Confirm all security-sensitive success/failure paths create redacted audit
  events.
- [ ] Confirm the last-active-root database constraint/check under concurrent
  requests (use a transaction or atomic conditional update, not count-then-write).
- [ ] Back up the database and document rollback: revert route/UI deployment
  without deleting roles, session versions, or audit records.

