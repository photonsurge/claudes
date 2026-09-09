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
# Copy the lockfile too — without it yarn re-resolves every dep to latest at
# image-build time (non-reproducible, and breaks when the registry mirror has
# a half-propagated release).
COPY public/package.json public/yarn.lock ./
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

# Next inlines every NEXT_PUBLIC_* at BUILD time, so these have to be build args
# here — setting them in the host's .env does nothing, the image is already made.
# Both are optional: unset keeps the shipped defaults.
#   WL_GRID_PATCH=off   diagnostic — disables the wind-grid sampling cache
#   TEXTURE_CACHE_MAX   decoded textures held in RAM (default 256, ~4 MB each)
ARG NEXT_PUBLIC_WL_GRID_PATCH
ENV NEXT_PUBLIC_WL_GRID_PATCH=${NEXT_PUBLIC_WL_GRID_PATCH}
ARG NEXT_PUBLIC_TEXTURE_CACHE_MAX
ENV NEXT_PUBLIC_TEXTURE_CACHE_MAX=${NEXT_PUBLIC_TEXTURE_CACHE_MAX}

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
# Standalone does NOT include the app's public/ static dir — copy it so
# /data/*.geojson and the basemap textures (satellite/terrain.jpg) are served.
COPY --from=builder --chown=nextjs:nodejs /app/public/public            ./public/public

USER nextjs
EXPOSE 3000

CMD ["node", "public/server.js"]
