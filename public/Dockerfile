# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f public/Dockerfile .

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Build shared so the local file: dep resolves
COPY shared ./shared
WORKDIR /app/shared
RUN --mount=type=cache,target=/root/.yarn/cache \
    yarn install && yarn build

WORKDIR /app/public
COPY public/package.json ./
RUN --mount=type=cache,target=/root/.yarn/cache yarn install


# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/shared              /app/shared
COPY --from=deps /app/public/node_modules ./node_modules

COPY public/ ./

ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL}

RUN yarn build


# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs --disabled-password nextjs

# Next.js standalone output bundles a minimal server + node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/public/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/public/.next/static      ./public/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "public/server.js"]
