import json
import re
import unicodedata
from datetime import datetime, timezone
from pymongo import MongoClient, UpdateOne
import os
import argparse

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "crossword")
COLL = "words"

# strict crossword fill: A-Z0-9 only
STRICT_ALLOWED_RE = re.compile(r"^[A-Za-z0-9]+$")
STRICT_AZ_RE = re.compile(r"^[A-Z]+$")
def now():
    return datetime.now(timezone.utc)

def ascii_fold(s: str) -> str:
    # turns naïve -> naive (optional step)
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")



def analyze_word(raw: str, min_len=2, max_len=24):
    """
    Returns (ok: bool, norm: str|None, reason: str|None)
    Policy: only A-Z allowed. Reject digits and all punctuation/spaces.
    """
    if raw is None:
        return False, None, "missing"
    w = raw.strip()
    if not w:
        return False, None, "blank"

    # hard reject common offenders quickly (keeps reasons useful)
    if any(ch.isdigit() for ch in w):
        return False, None, "contains-digit"
    if " " in w:
        return False, None, "contains-space"
    if "-" in w:
        return False, None, "contains-hyphen"
    if "'" in w or "’" in w:
        return False, None, "contains-apostrophe"

    # reject diacritics / non-ascii letters (safer than folding)
    if unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode("ascii") != w:
        return False, None, "contains-diacritics"

    # reject anything not letter (punct, underscore, etc.)
    if not re.fullmatch(r"[A-Za-z]+", w):
        return False, None, "contains-non-letter"

    norm = w.upper()

    if len(norm) < min_len:
        return False, None, "too-short"
    if len(norm) > max_len:
        return False, None, "too-long"

    # extra junk filter: all same letter like "AAAA"
    if len(set(norm)) == 1:
        return False, None, "all-same-letter"

    if not STRICT_AZ_RE.match(norm):
        return False, None, "not-AZ"

    return True, norm, None

def load_checkpoint(path: str) -> int:
    if not path or not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            return max(0, int((f.read() or "0").strip()))
    except Exception:
        return 0

def save_checkpoint(path: str, line_no: int) -> None:
    if not path:
        return
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(str(max(0, int(line_no))))
    os.replace(tmp, path)

def ingest_jsonl(path: str, batch_size: int = 1000, checkpoint_path: str | None = None, fresh: bool = False):
    client = MongoClient(MONGO_URI)
    col = client[DB_NAME][COLL]

    ops = []
    seen = 0
    non_empty_lines = 0
    progress_every = int(os.getenv("INGEST_PROGRESS_EVERY", "50000"))
    total_bytes = os.path.getsize(path)
    bytes_read = 0
    started_at = now()
    line_no = 0
    checkpoint_path = checkpoint_path or f"{path}.checkpoint"

    if fresh and checkpoint_path and os.path.exists(checkpoint_path):
        os.remove(checkpoint_path)

    resume_line = 0 if fresh else load_checkpoint(checkpoint_path)
    if resume_line > 0:
        print(f"↩ resuming from checkpoint line={resume_line:,} ({checkpoint_path})")
    else:
        print(f"▶ starting fresh from line 1 ({checkpoint_path})")

    with open(path, "r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            bytes_read += len(raw_line.encode("utf-8"))
            if line_no <= resume_line:
                continue
            line = raw_line.strip()
            if not line:
                continue
            non_empty_lines += 1
            obj = json.loads(line)
            raw_word = obj.get("word", "")
            definitions = obj.get("definitions") or []

            ok, norm, reason = analyze_word(raw_word)

            base = {
                "language": "en",
                "raw": {
                    "importWord": raw_word,
                    "definitions": definitions,
                    "source": {"name": "jsonl"},
                    "ingestedAt": now(),
                },
                "updatedAt": now(),
            }

            if ok:
                doc = {
                    **base,
                    "createdAt": now(),
                    "word": norm,
                    "norm": norm,
                    "length": len(norm),
                    "pos": [],
                    "categorySlugs": [],
                    "flags": {"adult": False, "vulgar": False, "offensive": False},
                    "senses": [],
                    "dictionary": {"oxford": {"inDictionary": None, "headwordId": None, "lastVerifiedAt": None}},
                    "enrichment": {"status": "pending", "model": None, "lastRunAt": None, "errors": []},
                }
                ops.append(UpdateOne(
                    {"language": "en", "norm": norm},
                    {"$setOnInsert": doc},
                    upsert=True
                ))
            else:
                # store rejected items too (separate by key so they don't collide)
                rej_key = f"rejected:{raw_word.strip()}"
                doc = {
                    **base,
                    "createdAt": now(),
                    "word": None,
                    "norm": None,
                    "length": None,
                    "rejectedKey": rej_key,
                    "enrichment": {"status": "rejected", "reason": reason},
                }
                ops.append(UpdateOne(
                    {"language": "en", "rejectedKey": rej_key},
                    {"$setOnInsert": doc},
                    upsert=True
                ))

            if len(ops) >= batch_size:
                col.bulk_write(ops, ordered=False)
                seen += len(ops)
                save_checkpoint(checkpoint_path, line_no)
                elapsed = max((now() - started_at).total_seconds(), 0.001)
                pct = min(100.0, (bytes_read / total_bytes) * 100.0) if total_bytes > 0 else 0.0
                print(
                    f"batch line={line_no:,} written={seen:,} nonEmpty={non_empty_lines:,} "
                    f"through={pct:.2f}% elapsed={elapsed:,.1f}s"
                )
                ops = []

            if progress_every > 0 and (line_no % progress_every == 0):
                elapsed = max((now() - started_at).total_seconds(), 0.001)
                pct = min(100.0, (bytes_read / total_bytes) * 100.0) if total_bytes > 0 else 0.0
                lps = line_no / elapsed
                print(
                    f"progress line={line_no:,} nonEmpty={non_empty_lines:,} "
                    f"through={pct:.2f}% rate={lps:,.0f} lines/s bufferedOps={len(ops):,}"
                )

    if ops:
        col.bulk_write(ops, ordered=False)
        seen += len(ops)
        save_checkpoint(checkpoint_path, line_no)
        elapsed = max((now() - started_at).total_seconds(), 0.001)
        pct = min(100.0, (bytes_read / total_bytes) * 100.0) if total_bytes > 0 else 0.0
        print(
            f"batch line={line_no:,} written={seen:,} nonEmpty={non_empty_lines:,} "
            f"through={pct:.2f}% elapsed={elapsed:,.1f}s"
        )

    cp = load_checkpoint(checkpoint_path)
    print(
        f"✅ processed ~{seen} lines (accepted + rejected), nonEmpty={non_empty_lines:,}, "
        f"checkpointLine={cp:,}"
    )

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default="out/en_word_defs.jsonl")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--checkpoint", default=None)
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()

    ingest_jsonl(
        args.path,
        batch_size=args.batch_size,
        checkpoint_path=args.checkpoint,
        fresh=args.fresh,
    )
