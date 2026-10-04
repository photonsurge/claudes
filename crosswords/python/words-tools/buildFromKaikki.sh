#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

KAIKKI_DIR="${ROOT_DIR}/python/tools/kaikki"
OUT_DIR="${ROOT_DIR}/python/tools/out"
KAIKKI_GZ="${KAIKKI_DIR}/raw-wiktextract-data.jsonl.gz"
OUT_JSONL="${OUT_DIR}/en_word_defs.jsonl"

# Kaikki pre-extracted English Wiktionary data (no local Lua expansion step).
KAIKKI_URL="${KAIKKI_URL:-https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz}"
KAIKKI_FALLBACK_URL_1="https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
KAIKKI_FALLBACK_URL_2="https://kaikki.org/dictionary/English/words/raw-wiktextract-data.jsonl.gz"

mkdir -p "${KAIKKI_DIR}" "${OUT_DIR}"

if [[ ! -f "${KAIKKI_GZ}" ]]; then
  echo "Downloading Kaikki dump..."
  if ! curl -fL "${KAIKKI_URL}" -o "${KAIKKI_GZ}"; then
    echo "Primary URL failed, trying fallbacks..."
    if ! curl -fL "${KAIKKI_FALLBACK_URL_1}" -o "${KAIKKI_GZ}"; then
      curl -fL "${KAIKKI_FALLBACK_URL_2}" -o "${KAIKKI_GZ}"
    fi
  fi
fi

python "${ROOT_DIR}/python/tools/build_word_defs.py" \
  --single-token-only \
  "${KAIKKI_GZ}" \
  "${OUT_JSONL}"

echo "Wrote ${OUT_JSONL}"
