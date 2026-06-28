# syntax=docker/dockerfile:1
# Build context must be the repo root:
#   docker build -f worker/Dockerfile .

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS deps
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
FROM node:24-bookworm-slim AS builder
WORKDIR /app/worker

COPY --from=deps /app/shared               /app/shared
COPY --from=deps /app/worker/node_modules  ./node_modules

COPY worker/src           ./src
COPY worker/tsconfig.json ./
COPY worker/package.json  ./

RUN yarn build


# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10102

# wgrib2 is a RUNTIME dependency (real GFS ingest shells out to it). Debian has
# no wgrib2 package, so build it from NOAA source. We intentionally keep the
# build toolchain in the image (bloat accepted) so the binary is guaranteed to
# find its runtime libs. ca-certificates is needed for HTTPS downloads.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential gfortran wget cmake unzip file ca-certificates && \
    cd /tmp && \
    wget -q https://www.ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz && \
    tar xf wgrib2.tgz && \
    cd grib2 && \
    CC=gcc FC=gfortran make && \
    cp wgrib2/wgrib2 /usr/local/bin/wgrib2 && \
    cd / && rm -rf /tmp/wgrib2.tgz /tmp/grib2 && \
    rm -rf /var/lib/apt/lists/* && \
    wgrib2 -version

RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs --no-create-home worker

COPY --from=builder --chown=worker:nodejs /app/worker/dist         ./dist
COPY --from=builder --chown=worker:nodejs /app/worker/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/worker/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/shared              ./shared

USER worker
EXPOSE 8080

CMD ["node", "dist/index.js"]
