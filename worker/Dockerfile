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

# Runtime GRIB/netCDF tooling the worker shells out to:
#   - wgrib2 : GFS/wave bake + -new_grid regrid. Debian has no package, so build
#              it from NOAA source (build toolchain kept in the image on purpose).
#   - cdo    : RTOFS netCDF-4 → GRIB2 (`cdo -f grb2 copy`), so RTOFS drops into the
#              wgrib2 bake path. Debian ships `cdo` (pulls netCDF/HDF5/eccodes libs).
# ca-certificates is needed for the HTTPS wgrib2 download.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential gfortran wget cmake unzip file ca-certificates cdo && \
    cd /tmp && \
    wget -q --tries=3 --timeout=60 --retry-connrefused \
      https://www.ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz && \
    tar xf wgrib2.tgz && \
    cd grib2 && \
    CC=gcc FC=gfortran make && \
    cp wgrib2/wgrib2 /usr/local/bin/wgrib2 && \
    cd / && rm -rf /tmp/wgrib2.tgz /tmp/grib2 && \
    rm -rf /var/lib/apt/lists/* && \
    # wgrib2 prints its version banner but exits 8 when given no GRIB file, so
    # verify it runs by checking the banner output, not its exit code.
    wgrib2 -version 2>&1 | grep -qiE 'v[0-9]' && \
    # cdo -V prints its banner to stderr and exits 0.
    cdo -V 2>&1 | grep -qiE 'Climate Data Operators|cdo version'

RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs --no-create-home worker && \
    mkdir -p /app/dem-cache && chown worker:nodejs /app/dem-cache

COPY --from=builder --chown=worker:nodejs /app/worker/dist         ./dist
COPY --from=builder --chown=worker:nodejs /app/worker/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/worker/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/shared              ./shared

# Natural Earth admin-0 geojson (from ./fetch-assets.sh, same source the Next app
# serves at /data). The countries.seed job masks area-weather against it. The
# worker bakes in its OWN copy and reads it via WEATHER_DATA_DIR, so it never
# reaches into the public app's static folder. Run ./fetch-assets.sh before
# building, or this COPY fails the build.
COPY --chown=worker:nodejs public/public/data/countries.geojson /app/data/countries.geojson
ENV WEATHER_DATA_DIR=/app/data

USER worker
EXPOSE 8080

CMD ["node", "dist/index.js"]
