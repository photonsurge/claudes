import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from bson import ObjectId
from pymongo import MongoClient, UpdateOne

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "crossword")
WORDS_COLL = "words"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

DEFAULT_CHECKPOINT = os.path.join(SCRIPT_DIR, "validate_words.checkpoint.json")
DEFAULT_VERSION = 1
DEFAULT_BATCH_SIZE = 500


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def load_checkpoint(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def save_checkpoint(path: str, state: Dict[str, Any]) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def resolve_path(path: str) -> str:
    if not path:
        return path
    if os.path.isabs(path):
        return path
    p1 = os.path.abspath(path)
    if os.path.exists(p1):
        return p1
    p2 = os.path.abspath(os.path.join(SCRIPT_DIR, path))
    if os.path.exists(p2):
        return p2
    p3 = os.path.abspath(os.path.join(REPO_ROOT, path))
    if os.path.exists(p3):
        return p3
    return p1


def parse_hunspell_dic(path: str) -> Set[str]:
    words: Set[str] = set()
    if not os.path.exists(path):
        return words
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for idx, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            if idx == 0 and line.isdigit():
                continue
            term = line.split("/", 1)[0].strip().lower()
            if term:
                words.add(term)
    return words


def parse_plain_wordlist(path: str) -> Set[str]:
    words: Set[str] = set()
    if not os.path.exists(path):
        return words
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip().lower()
            if not line or line.startswith("#"):
                continue
            words.add(line)
    return words


@dataclass
class Providers:
    hunspell_words: Set[str]
    hunspell_source: Optional[str]
    scowl_words: Set[str]
    scowl_source: Optional[str]
    wordnet_available: bool
    zipf_available: bool


def build_providers(
    hunspell_dic_paths: List[str],
    scowl_path: Optional[str],
    nltk_data_path: Optional[str],
) -> Providers:
    hunspell_words: Set[str] = set()
    hunspell_source: Optional[str] = None
    for p in hunspell_dic_paths:
        p = (p or "").strip()
        if not p:
            continue
        parsed = parse_hunspell_dic(p)
        if parsed:
            hunspell_words |= parsed
            if not hunspell_source:
                hunspell_source = p

    scowl_words: Set[str] = set()
    scowl_source: Optional[str] = None
    if scowl_path:
        parsed = parse_plain_wordlist(scowl_path)
        if parsed:
            scowl_words = parsed
            scowl_source = scowl_path

    # Ensure NLTK uses our local folder if provided.
    if nltk_data_path:
        os.environ["NLTK_DATA"] = nltk_data_path

    wordnet_available = False
    try:
        import nltk  # noqa: F401
        from nltk.corpus import wordnet as wn  # noqa: F401

        _ = wn.synsets("test")
        wordnet_available = True
    except Exception:
        wordnet_available = False

    zipf_available = False
    try:
        from wordfreq import zipf_frequency  # noqa: F401

        zipf_available = True
    except Exception:
        zipf_available = False

    return Providers(
        hunspell_words=hunspell_words,
        hunspell_source=hunspell_source,
        scowl_words=scowl_words,
        scowl_source=scowl_source,
        wordnet_available=wordnet_available,
        zipf_available=zipf_available,
    )


def preflight_or_raise(
    hunspell_dic_paths: List[str],
    scowl_path: Optional[str],
    nltk_data_path: Optional[str],
    require_scowl: bool,
    require_wordfreq: bool,
) -> Providers:
    problems: List[str] = []

    # Path existence checks (human-friendly)
    good_hunspell_paths: List[str] = []
    for p in hunspell_dic_paths:
        p = (p or "").strip()
        if not p:
            continue
        if not os.path.exists(p):
            problems.append(f"Hunspell .dic not found: {p}")
        else:
            good_hunspell_paths.append(p)

    if not good_hunspell_paths:
        problems.append(
            "No valid Hunspell .dic paths provided/found. "
            "Pass --hunspell-dic /path/to/en_GB.dic (can be repeated)."
        )

    if scowl_path:
        if not os.path.exists(scowl_path):
            problems.append(f"SCOWL wordlist not found: {scowl_path}")
    elif require_scowl:
        problems.append("SCOWL required but --scowl-path not provided.")

    if nltk_data_path:
        if not os.path.exists(nltk_data_path):
            problems.append(f"NLTK_DATA path not found: {nltk_data_path}")

    if problems:
        raise RuntimeError("Preflight failed:\n- " + "\n- ".join(problems))

    providers = build_providers(
        hunspell_dic_paths=good_hunspell_paths,
        scowl_path=scowl_path,
        nltk_data_path=nltk_data_path,
    )

    # Content checks
    if not providers.hunspell_words:
        problems.append(
            "Hunspell dictionary loaded 0 words. Check the .dic file contents."
        )

    if require_scowl and not providers.scowl_words:
        problems.append(
            "SCOWL wordlist loaded 0 words (required). Ensure file is one word per line."
        )

    if not providers.wordnet_available:
        problems.append(
            "WordNet unavailable.\n"
            "Fix (offline):\n"
            f"  mkdir -p {nltk_data_path or 'dumps/nltk_data'}\n"
            f"  python -c \"import nltk; nltk.download('wordnet', download_dir='{nltk_data_path or 'dumps/nltk_data'}'); "
            f"nltk.download('omw-1.4', download_dir='{nltk_data_path or 'dumps/nltk_data'}')\"\n"
            "Then rerun with: --nltk-data <that-folder>"
        )

    if require_wordfreq and not providers.zipf_available:
        problems.append("wordfreq unavailable (required). Install: pip install wordfreq")

    if problems:
        raise RuntimeError("Preflight failed:\n- " + "\n- ".join(problems))

    # Helpful summary
    print(f"✅ hunspell words: {len(providers.hunspell_words):,} ({providers.hunspell_source})")
    print(f"✅ scowl words: {len(providers.scowl_words):,} ({providers.scowl_source})")
    print(f"✅ wordnet available: {providers.wordnet_available}")
    print(f"✅ wordfreq available: {providers.zipf_available}")

    return providers


def validate_one(word_upper: str, providers: Providers, version: int) -> Dict[str, Any]:
    w = (word_upper or "").strip().lower()
    score = 0.0
    sources: Dict[str, Any] = {}

    # Hunspell membership
    if providers.hunspell_words:
        accepted = w in providers.hunspell_words
        score += 0.45 if accepted else -0.35
        sources["hunspell"] = {
            "checked": True,
            "accepted": accepted,
            "dictionary": providers.hunspell_source,
        }
    else:
        sources["hunspell"] = {"checked": False, "reason": "dictionary-not-found"}

    # SCOWL membership (optional)
    if providers.scowl_words:
        in_list = w in providers.scowl_words
        score += 0.20 if in_list else -0.10
        sources["scowl"] = {
            "checked": True,
            "inList": in_list,
            "source": providers.scowl_source,
        }
    else:
        sources["scowl"] = {"checked": False, "reason": "wordlist-not-found"}

    # WordNet
    if providers.wordnet_available:
        from nltk.corpus import wordnet as wn

        synsets = wn.synsets(w)
        pos = sorted(set(s.pos() for s in synsets))
        found = len(synsets) > 0
        score += 0.20 if found else -0.05
        sources["wordnet"] = {
            "checked": True,
            "foundLemma": found,
            "pos": pos,
            "synsetCount": len(synsets),
        }
    else:
        sources["wordnet"] = {"checked": False, "reason": "wordnet-unavailable"}

    # Frequency (optional)
    if providers.zipf_available:
        from wordfreq import zipf_frequency

        zipf = float(zipf_frequency(w, "en"))
        if zipf >= 4.0:
            score += 0.25
            band = "common"
        elif zipf >= 3.0:
            score += 0.15
            band = "mid"
        elif zipf >= 2.0:
            score += 0.05
            band = "rare"
        else:
            score -= 0.15
            band = "very-rare"

        sources["wordfreq"] = {
            "checked": True,
            "zipf": round(zipf, 4),
            "rankBand": band,
        }
    else:
        sources["wordfreq"] = {"checked": False, "reason": "wordfreq-unavailable"}

    checked_count = sum(1 for v in sources.values() if v.get("checked"))
    if checked_count == 0:
        decision = "review"
        notes = ["no-validation-sources"]
    elif score >= 0.55:
        decision = "accepted"
        notes = []
    elif score >= 0.20:
        decision = "review"
        notes = ["borderline-score"]
    else:
        decision = "reject"
        notes = []

    return {
        "version": version,
        "runAt": now_iso(),
        "sources": sources,
        "decision": decision,
        "score": round(score, 4),
        "notes": notes,
    }


def run_validation(
    batch_size: int,
    checkpoint_path: str,
    fresh: bool,
    limit: Optional[int],
    version: int,
    hunspell_dic_paths: List[str],
    scowl_path: Optional[str],
    nltk_data_path: Optional[str],
    require_scowl: bool,
    require_wordfreq: bool,
) -> None:
    if fresh and os.path.exists(checkpoint_path):
        os.remove(checkpoint_path)

    providers = preflight_or_raise(
        hunspell_dic_paths=hunspell_dic_paths,
        scowl_path=scowl_path,
        nltk_data_path=nltk_data_path,
        require_scowl=require_scowl,
        require_wordfreq=require_wordfreq,
    )

    cp = load_checkpoint(checkpoint_path)
    last_id = cp.get("last_id")
    processed_total = int(cp.get("processed", 0))
    accepted_total = int(cp.get("accepted", 0))
    review_total = int(cp.get("review", 0))
    reject_total = int(cp.get("reject", 0))

    if last_id:
        print(f"↩ resume from _id>{last_id} ({checkpoint_path})")
    else:
        print(f"▶ start fresh ({checkpoint_path})")

    mongo = MongoClient(MONGO_URI)
    words = mongo[DB_NAME][WORDS_COLL]

    processed_run = 0
    while True:
        q: Dict[str, Any] = {
            "norm": {"$type": "string", "$ne": ""},
            "validation.version": {"$ne": version},
        }
        if last_id:
            q["_id"] = {"$gt": ObjectId(last_id)}

        docs = list(words.find(q, {"norm": 1}).sort("_id", 1).limit(batch_size))
        if not docs:
            print("✅ no more docs to validate")
            break

        ops: List[UpdateOne] = []
        ts = now_dt()

        for d in docs:
            validation = validate_one(d.get("norm", ""), providers, version=version)
            decision = validation.get("decision")
            if decision == "accepted":
                accepted_total += 1
            elif decision == "review":
                review_total += 1
            else:
                reject_total += 1

            ops.append(
                UpdateOne(
                    {"_id": d["_id"]},
                    {"$set": {"validation": validation, "updatedAt": ts}},
                )
            )

        if ops:
            words.bulk_write(ops, ordered=False)

        last_id = str(docs[-1]["_id"])
        processed_total += len(docs)
        processed_run += len(docs)

        state = {
            "last_id": last_id,
            "processed": processed_total,
            "accepted": accepted_total,
            "review": review_total,
            "reject": reject_total,
            "version": version,
            "updated_at": now_iso(),
        }
        save_checkpoint(checkpoint_path, state)

        print(
            f"batch={len(docs):,} run={processed_run:,} total={processed_total:,} "
            f"accepted={accepted_total:,} review={review_total:,} reject={   reject_total:,} last_id={last_id}"
        )

        if limit is not None and processed_run >= limit:
            print(f"🛑 reached run limit={limit:,}")
            break

    print(
        f"done run={processed_run:,} total={processed_total:,} "
        f"accepted={accepted_total:,} review={review_total:,} reject={reject_total:,}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--version", type=int, default=DEFAULT_VERSION)

    parser.add_argument(
        "--hunspell-dic",
        action="append",
        default=[],
        help="Path to hunspell .dic file. Can be provided multiple times.",
    )
    parser.add_argument(
        "--scowl-path",
        default=os.path.join(SCRIPT_DIR, "dumps", "scowl", "words.txt"),
        help="Path to plain wordlist file for SCOWL-like check.",
    )
    parser.add_argument(
        "--nltk-data",
        default=os.path.join(SCRIPT_DIR, "dumps", "nltk_data"),
        help="NLTK data path for local WordNet corpus.",
    )

    # Preflight strictness knobs
    parser.add_argument("--require-scowl", action="store_true", help="Fail if SCOWL not loaded.")
    parser.add_argument("--require-wordfreq", action="store_true", help="Fail if wordfreq not available.")

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    hunspell_paths = args.hunspell_dic or [
        os.path.join(SCRIPT_DIR, "dumps", "hunspell", "en_GB.dic"),
    ]
    hunspell_paths = [resolve_path(p) for p in hunspell_paths]
    scowl_path = resolve_path(args.scowl_path) if args.scowl_path else None
    nltk_data_path = resolve_path(args.nltk_data) if args.nltk_data else None

    run_validation(
        batch_size=max(1, int(args.batch_size)),
        checkpoint_path=args.checkpoint,
        fresh=bool(args.fresh),
        limit=args.limit,
        version=max(1, int(args.version)),
        hunspell_dic_paths=hunspell_paths,
        scowl_path=scowl_path,
        nltk_data_path=nltk_data_path,
        require_scowl=bool(args.require_scowl),
        require_wordfreq=bool(args.require_wordfreq),
    )


if __name__ == "__main__":
    main()
