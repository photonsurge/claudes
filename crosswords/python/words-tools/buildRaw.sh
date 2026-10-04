#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DUMP_PATH="${ROOT_DIR}/python/tools/dumps/enwiktionary-latest-pages-articles.xml.bz2"
OUT_DIR="${ROOT_DIR}/python/tools/out"
OUT_JSONL="${OUT_DIR}/raw.jsonl"
TMP_JSONL="${OUT_DIR}/raw.jsonl.tmp"
ERR_JSONL="${OUT_DIR}/wiktwords-errors.jsonl"
STDERR_LOG="${OUT_DIR}/wiktwords-stderr.log"
THREADS="${THREADS:-8}"
WIKT_LANGUAGE="${WIKT_LANGUAGE:-English}"
WIKTWORDS_BIN="${WIKTWORDS_BIN:-/home/rich/anaconda3/envs/wiki-extract/bin/wiktwords}"

mkdir -p "${OUT_DIR}"

if [[ ! -f "${DUMP_PATH}" ]]; then
  echo "Missing dump: ${DUMP_PATH}" >&2
  exit 1
fi

if [[ ! -x "${WIKTWORDS_BIN}" ]]; then
  echo "Missing wiktwords binary: ${WIKTWORDS_BIN}" >&2
  exit 1
fi

# Keep previous outputs around to avoid accidental data loss from partial reruns.
if [[ -f "${OUT_JSONL}" ]]; then
  mv -f "${OUT_JSONL}" "${OUT_JSONL}.prev"
fi
if [[ -f "${ERR_JSONL}" ]]; then
  mv -f "${ERR_JSONL}" "${ERR_JSONL}.prev"
fi
if [[ -f "${STDERR_LOG}" ]]; then
  mv -f "${STDERR_LOG}" "${STDERR_LOG}.prev"
fi
if [[ -f "${TMP_JSONL}" ]]; then
  rm -f "${TMP_JSONL}"
fi

exec "${WIKTWORDS_BIN}" \
  "${DUMP_PATH}" \
  --out "${OUT_JSONL}" \
  --errors "${ERR_JSONL}" \
  --language "${WIKT_LANGUAGE}" \
  --num-threads "${THREADS}" \
  2> "${STDERR_LOG}"
