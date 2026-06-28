# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f worker/Dockerfile .

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Build shared first (worker depends on it via file:)
COPY shared ./shared
WORKDIR /app/shared
RUN --mount=type=cache,target=/root/.yarn/cache \
    yarn install && yarn build

WORKDIR /app/worker
COPY worker/package.json ./
RUN --mount=type=cache,target=/root/.yarn/cache yarn install


# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app/worker

COPY --from=deps /app/shared               /app/shared
COPY --from=deps /app/worker/node_modules  ./node_modules

COPY worker/src           ./src
COPY worker/tsconfig.json ./
COPY worker/package.json  ./

RUN yarn build


# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs --disabled-password worker

COPY --from=builder --chown=worker:nodejs /app/worker/dist         ./dist
COPY --from=builder --chown=worker:nodejs /app/worker/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/worker/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/shared              ./shared

USER worker
EXPOSE 8080

CMD ["node", "dist/index.js"]
