#!/usr/bin/env bash
# Download the globe's static basemap assets into public/public/data so the app
# serves them locally (/data/...) instead of hitting external CDNs at runtime.
# These are NOT committed (see .gitignore). Re-run any time to refresh.
set -euo pipefail
cd "$(dirname "$0")"

DEST="public/public/data"
mkdir -p "$DEST"

dl() { # url  outfile
  echo "==> $2"
  curl -fSL -m120 -o "$DEST/$2" "$1"
}

# Satellite (Blue Marble 8k) + terrain (NASA topo+bathymetry 5400) — base images
# under the zoom-gated XYZ tile overlay. -A needed for solarsystemscope.
curl -fSL -m120 -A "Mozilla/5.0" -o "$DEST/satellite.jpg" \
  "https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg"
curl -fSL -m120 -A "Mozilla/5.0" -o "$DEST/terrain.jpg" \
  "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg"

# Natural Earth 50m vectors for the dark basemap + country borders.
dl "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson"            "land.geojson"
dl "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson" "countries.geojson"

echo "==> Done. Assets in $DEST:"
ls -lh "$DEST"
