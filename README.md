# Blank App

A minimal, single-domain monorepo scaffold: a shared TypeScript library feeding
a Next.js frontend, a Socket.IO server, and a BullMQ worker. It is the bare
**infra skeleton** — no business logic — with one tiny end-to-end "ping" feature
wired up so you can see all four pieces talking to each other.

> Single-domain by design: there is exactly one logical site, so there is **no**
> master/tenant DB split and no per-domain routing.

## Packages

| Package   | Name                  | Purpose |
|-----------|-----------------------|---------|
| `shared`  | `@photonsurge/shared` | Shared lib: Mongo connection, DB CRUD factory, BullMQ queue, JWT, env, logger. Built to `dist/` and consumed via `file:../shared`. |
| `public`  | `public`              | Next.js 16 frontend. Mints socket tokens, exposes `/api/ping`, renders live events. |
| `socket`  | `socket`              | Socket.IO server. Authenticates `user` (browser) and `worker` (service) actors and relays worker events to clients. |
| `worker`  | `worker`              | BullMQ worker. Auto-discovers job handlers in `src/jobs/`, processes them, emits results up to the socket server. |

There is no root `package.json`. Each package installs independently; `shared`
is linked into the others via a `file:` dependency.

## The sample "ping" flow

```
 browser ──POST /api/ping──▶ public ──sendToQueue──▶ Redis (BullMQ)
                                                         │
                                                         ▼
 browser ◀──"ping:done"── socket ◀──worker:event── worker (jobs/ping.ts)
                                                         │
                                                    persists to Mongo
```

1. The browser loads, fetches a short-lived JWT from `/api/auth/socket-token`,
   and connects to the socket server as actor type `user` (joins the `public` room).
2. Clicking **Send ping** POSTs to `/api/ping`, which calls `sendToQueue(...)`.
3. The worker picks up the `ping`/`create` job, writes a record to Mongo, and
   calls `emitWorkerEvent({ type: "ping:done", ... })`.
4. The worker is connected to the socket server as actor type `worker`; the
   socket server relays the event to everyone in the `public` room.
5. The browser receives `ping:done` and appends it to the list.

## Local development

Requires Node 24+, Yarn 1.x, and a local (or remote) **MongoDB** and **Redis**.

```bash
# 1. Env
cp .env.sample .env
# generate secrets: openssl rand -hex 32  → JWT_SECRET, WORKER_AUTH_SECRET, SOCKET_TOKEN_SECRET
# point MONGODB_URI / REDIS_SERVER at your instances

# 2. Build the shared lib (the others depend on its dist/)
cd shared && yarn install && yarn build && cd ..

# 3. Install + run each service (separate terminals)
cd socket && yarn install && yarn dev      # :4000
cd worker && yarn install && yarn dev      # :8080 (HTTP health) + queue consumer
cd public && yarn install && yarn dev      # :3000
```

Open http://localhost:3000 and press **Send ping**.

> After changing anything in `shared`, run `./update-shared` to rebuild it and
> refresh the copy inside `worker`, `socket`, and `public`.

## Docker

Each service has a Dockerfile that builds from the **repo root** (so `shared` is
in the build context). `docker-compose.yml` wires up Mongo, Redis, and all three
services.

```bash
cp .env.sample .env     # fill in secrets; use service-name hosts (mongodb/redis)
./build                 # build shared + all images
./start.sh              # docker compose up -d
./stop.sh               # docker compose down   (add -v to wipe data)
```

Published ports: `public` → 3000, `socket` → 4000. Mongo, Redis and `worker`
stay internal to the compose network.

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `MONGODB_URI` | shared/worker/public | Single database connection string. |
| `REDIS_SERVER`, `REDIS_PORT`, `REDIS_PASSWORD` | shared (BullMQ) | Queue + cache. |
| `JWT_SECRET` | shared | Default JWT signing secret (issuer `thronix`). |
| `WORKER_AUTH_SECRET` | worker, socket | Signs/validates the `worker` actor token. |
| `SOCKET_TOKEN_SECRET` | public, socket | Signs/validates the browser (`user`) token. |
| `SOCKET_URL` | worker | Server-to-server URL of the socket server. |
| `NEXT_PUBLIC_SOCKET_URL` | public | Browser-facing socket URL (inlined at build). |
| `ALLOWED_ORIGINS` | socket | CORS allow-list (comma separated). |
| `APP_DOMAIN` | public | Logical label carried on queue jobs. |

## Conventions

- **Never use Mongo `_id`.** Every entity has its own string `id` (UUID). The DB
  factory (`shared/src/db/generic.ts`) keys everything on `id` and strips `_id`.
- DB responses are always `{ success, data?, errors? }` (`tGeneralResponse`).
- Jobs are dispatched as `{ type, event, data }`; the worker routes them to the
  matching exported function in `src/jobs/<type>.ts`.

### Add a new background job

1. Create `worker/src/jobs/<type>.ts` exporting a function per event:
   ```ts
   import type { Job } from "bullmq";
   export async function create(job: Job) { /* ... */ }
   ```
2. Enqueue it from anywhere: `sendToQueue("default", "<type>", "create", { ... })`.
3. (Optional) emit a result to clients with `emitWorkerEvent({ type, data })`.

### Add a new collection

Add a `makeCollection<T>(conn, "name")` line to `createDb()` in
`shared/src/db/index.ts`, then rebuild shared.

## Scripts

| Script | What it does |
|---|---|
| `./build` | Build `shared`, then build all Docker images. |
| `./start.sh` / `./stop.sh` | `docker compose up -d` / `down`. |
| `./update-shared` | Rebuild `shared` and refresh it in every dependent. |
| `./version-update [-m] [pkg]` | Bump patch (or minor) version in one/all packages. |
