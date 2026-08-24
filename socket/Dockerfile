# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f socket/Dockerfile .

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Build shared first (socket depends on it via file:)
COPY shared ./shared
WORKDIR /app/shared
RUN --mount=type=cache,target=/root/.yarn/cache \
    yarn install && yarn build

WORKDIR /app/socket
# Lockfile too, so the image installs the pinned versions instead of
# re-resolving to latest at build time.
COPY socket/package.json socket/yarn.lock ./
RUN --mount=type=cache,target=/root/.yarn/cache yarn install


# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app/socket

COPY --from=deps /app/shared               /app/shared
COPY --from=deps /app/socket/node_modules  ./node_modules

COPY socket/src           ./src
COPY socket/tsconfig.json ./
COPY socket/package.json  ./

RUN yarn build


# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs --disabled-password socket

COPY --from=builder --chown=socket:nodejs /app/socket/dist         ./dist
COPY --from=builder --chown=socket:nodejs /app/socket/node_modules ./node_modules
COPY --from=builder --chown=socket:nodejs /app/socket/package.json ./package.json
COPY --from=builder --chown=socket:nodejs /app/shared              ./shared

USER socket
EXPOSE 4000

CMD ["node", "dist/index.js"]
