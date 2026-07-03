#!/usr/bin/env python3
"""
Himawari-9 full-disk → full-globe plate-carrée RGBA PNG.

The worker shells out to this sidecar (worker/src/satimg/bake.ts) exactly as the
GRIB path shells out to wgrib2: the Node worker never touches Python state, it just
spawns this, reads a PNG file, and parses ONE line of JSON from stdout.

Pipeline
  1. Find the latest COMPLETE 10-min FLDK scan slot on the OPEN `noaa-himawari9`
     S3 bucket (anonymous — no credentials, no egress cost from the bucket side).
  2. Download the HSD (.bz2) segments for the bands the chosen composite needs
     (satpy reads the .bz2 HSD directly; no manual bunzip).
  3. satpy: load the composite, reproject the geostationary disk onto a GLOBAL
     equirectangular grid — transparent (alpha 0) outside the Earth disk.
  4. Save an RGBA PNG to --out and print a one-line JSON metadata blob to stdout.

Contract with the Node caller:
  * stdout: exactly one line — a JSON object (the frame metadata). NOTHING else.
  * stderr: all human/progress logging (never parsed).
  * exit 0 on success (PNG written + JSON printed); non-zero on any failure.

This is deliberately dependency-heavy on the Python side (satpy/pyresample/etc.) and
zero-dependency on the Node side — the same trade the wgrib2 shell-out makes.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import shutil
from datetime import datetime, timedelta, timezone


BUCKET = "noaa-himawari9"
PREFIX = "AHI-L1b-FLDK"
SEGMENTS = 10  # FLDK is split into 10 latitude segments per band

# The one bird we ingest today. Mirrors shared/src/satimg/types.ts SATIMG_SATS so
# the metadata this prints matches the registry the client renders from.
SATS = {
    "himawari9": {"name": "Himawari-9", "subLon": 140.7, "sat_short": "H09"},
}

# Which AHI bands each composite needs. satpy resolves the recipe, but we must only
# DOWNLOAD the bands it will actually use — pulling all 16 (esp. the 0.5 km B03)
# would be gratuitously heavy. A bare "B##" composite name means that single band.
BANDS_FOR_COMPOSITE = {
    "true_color": [1, 2, 3, 4],   # hybrid green + Rayleigh correction (needs pyspectral)
    "natural_color": [3, 4, 5],   # no atmospheric correction; daytime
    "cloudtop": [7, 13, 15],
    "B13": [13],                  # clean IR 10.4 µm — works day AND night
    "B03": [3],
}


def log(*a):
    print("[himawari.py]", *a, file=sys.stderr, flush=True)


def bands_for(composite: str) -> list[int]:
    if composite in BANDS_FOR_COMPOSITE:
        return BANDS_FOR_COMPOSITE[composite]
    # Bare band name like "B08" -> [8].
    if composite.upper().startswith("B") and composite[1:].isdigit():
        return [int(composite[1:])]
    raise SystemExit(f"unknown composite '{composite}' — add it to BANDS_FOR_COMPOSITE")


def slot_dir(slot: datetime) -> str:
    """S3 prefix for a 10-min scan slot, e.g. noaa-himawari9/AHI-L1b-FLDK/2024/01/15/0230/"""
    return f"{BUCKET}/{PREFIX}/{slot:%Y/%m/%d/%H%M}/"


def find_latest_slot(fs, needed_bands: list[int], delay_min: int, lookback: int):
    """Walk back from now (UTC, floored to 10 min, minus a safety delay) until we hit
    a slot whose every needed band has all 10 segments present. Returns (slot, files)."""
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    floored_min = (now.minute // 10) * 10
    start = now.replace(minute=floored_min) - timedelta(minutes=delay_min)
    # Re-floor after subtracting the delay so we land on a real 10-min boundary.
    start = start.replace(minute=(start.minute // 10) * 10)

    for i in range(lookback):
        slot = start - timedelta(minutes=10 * i)
        d = slot_dir(slot)
        try:
            listing = fs.ls(d, detail=False)
        except FileNotFoundError:
            continue
        except Exception as e:  # transient S3 error — try the next slot
            log(f"list {d} failed: {e}")
            continue
        if not listing:
            continue

        names = [p.split("/")[-1] for p in listing]
        chosen: list[str] = []
        complete = True
        for b in needed_bands:
            tok = f"_B{b:02d}_"
            seg = [p for p, n in zip(listing, names) if tok in n and n.endswith(".DAT.bz2")]
            if len(seg) < SEGMENTS:
                complete = False
                break
            chosen.extend(seg)
        if complete:
            log(f"slot {slot:%Y-%m-%d %H:%M} complete ({len(chosen)} segments across {len(needed_bands)} band(s))")
            return slot, chosen
        log(f"slot {slot:%Y-%m-%d %H:%M} incomplete — walking back")

    raise SystemExit(f"no complete slot found in the last {lookback} attempts")


def main() -> int:
    ap = argparse.ArgumentParser(description="Bake a Himawari-9 full-disk into a global plate-carrée PNG")
    ap.add_argument("--out", required=True, help="output PNG path")
    ap.add_argument("--satellite", default="himawari9", choices=list(SATS.keys()))
    ap.add_argument("--composite", default="true_color", help="satpy composite or bare band name (e.g. B13)")
    ap.add_argument("--resolution", type=float, default=0.05, help="output grid resolution in degrees")
    ap.add_argument("--delay-min", type=int, default=20, help="skip slots newer than this (ingest lag)")
    ap.add_argument("--lookback", type=int, default=12, help="max 10-min slots to walk back")
    ap.add_argument("--slot", default=None, help="force a specific slot YYYYMMDDHHMM (UTC), else latest")
    ap.add_argument("--resampler", default="nearest", help="pyresample resampler (nearest|bilinear)")
    args = ap.parse_args()

    sat = SATS[args.satellite]
    needed = bands_for(args.composite)

    # Imports here (not at module top) so `--help` works without the heavy stack.
    import s3fs
    from satpy import Scene
    from satpy.enhancements.enhancer import get_enhanced_image
    from pyresample import create_area_def

    fs = s3fs.S3FileSystem(anon=True)

    if args.slot:
        slot = datetime.strptime(args.slot, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        d = slot_dir(slot)
        listing = fs.ls(d, detail=False)
        names = [p.split("/")[-1] for p in listing]
        files = [p for p, n in zip(listing, names)
                 if any(f"_B{b:02d}_" in n for b in needed) and n.endswith(".DAT.bz2")]
    else:
        slot, files = find_latest_slot(fs, needed, args.delay_min, args.lookback)

    tmp = tempfile.mkdtemp(prefix="himawari-")
    try:
        # Download the .bz2 segments locally; satpy's ahi_hsd reader decompresses them.
        local: list[str] = []
        for remote in files:
            dst = f"{tmp}/{remote.split('/')[-1]}"
            fs.get(remote, dst)
            local.append(dst)
        log(f"downloaded {len(local)} segment file(s) to {tmp}")

        scn = Scene(filenames=local, reader="ahi_hsd")
        scn.load([args.composite])

        # Global equirectangular (EPSG:4326) target. Baking onto full-globe bounds
        # means the client draws it with the same geometry as the base-map image.
        width = int(round(360.0 / args.resolution))
        height = int(round(180.0 / args.resolution))
        area = create_area_def(
            "global_platecarree",
            "EPSG:4326",
            width=width,
            height=height,
            area_extent=[-180.0, -90.0, 180.0, 90.0],
        )
        resampled = scn.resample(area, resampler=args.resampler)

        # Enhance (default stretch / composite recipe) then FORCE an alpha channel so
        # off-disk (NaN) pixels are TRANSPARENT. save_dataset/simple_image renders a
        # single IR band with opaque BLACK fill and no alpha, which as a globe overlay
        # would paint the whole planet black outside the disk. convert("RGBA") derives
        # alpha from the data mask (finite = opaque, NaN off-disk = alpha 0). Works for
        # both single bands (B13) and RGB composites (true_color).
        img = get_enhanced_image(resampled[args.composite]).convert("RGBA")
        img.save(args.out)

        start = scn.start_time
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        meta = {
            "satId": args.satellite,
            "satName": sat["name"],
            "subLon": sat["subLon"],
            "composite": args.composite,
            "observationTime": start.isoformat(),
            "bounds": [-180, -90, 180, 90],
            "width": width,
            "height": height,
            "slot": f"{slot:%Y%m%d%H%M}",
        }
        # THE contract: exactly one JSON line on stdout.
        print(json.dumps(meta), flush=True)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
