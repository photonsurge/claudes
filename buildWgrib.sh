#!/usr/bin/env bash
# Build & install wgrib2 from NOAA source — decodes GFS GRIB2 for the worker's
# real-data path (the seedSample demo does NOT need it). Run it yourself; it uses
# sudo for the apt installs and the final copy. Safe to re-run (no-op if present).
#
#   ./buildWgrib.sh
set -euo pipefail

if command -v wgrib2 >/dev/null 2>&1; then
  echo "==> wgrib2 already installed: $(wgrib2 -version 2>&1 | head -1)"
  exit 0
fi

# cmake is REQUIRED — without it the NOAA makefile fails:
#   "ERROR, Need cmake for AEC support, install cmake or set USE_AEC=0"
echo "==> Installing build dependencies (sudo)…"
sudo apt-get update
sudo apt-get install -y build-essential gfortran wget cmake unzip file ca-certificates

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

echo "==> Downloading wgrib2 source…"
wget -q https://www.ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz
tar xf wgrib2.tgz
cd grib2

echo "==> Building (this takes a few minutes)…"
export CC=gcc FC=gfortran
make

echo "==> Installing to /usr/local/bin (sudo)…"
sudo cp wgrib2/wgrib2 /usr/local/bin/wgrib2
sudo chmod +x /usr/local/bin/wgrib2

echo "==> Done: $(wgrib2 -version 2>&1 | head -1)"
echo "    Now: cd worker && yarn check   (with the worker running)"
