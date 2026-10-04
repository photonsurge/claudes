import os
import json
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from pymongo import MongoClient, UpdateOne, InsertOne
from openai import OpenAI






# db.words.updateMany(
#   {
#     "enrichment.status": { $in: ["failed", "done"] }
#   },
#   {
#     $set: {
#       "enrichment.status": "pending",
#       "enrichment.reason": null,
#       "updatedAt": new Date()
#     },
#     $unset: {
#       "enrichment.doneAt": ""
#     }
#   }
# )





MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "crossword")

VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:9090/v1")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "local")
MODEL = os.getenv("VLLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")

WORDS_COLL = "words"
CLUES_COLL = "clues"
DEFAULT_CONCURRENCY = int(os.getenv("ENRICH_CONCURRENCY", "1"))

_thread_local = threading.local()

def now():
    return datetime.now(timezone.utc)

def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")

ALLOWED_POS = {
    "noun","verb","adjective","adverb","interjection","pronoun",
    "preposition","conjunction","determiner","numeral","proper-noun","other"
}

SYSTEM = (
    "You enrich crossword word entries. "
    "Return ONLY strict JSON. No markdown. No commentary. "
    "If unsure, prefer empty arrays/false over guessing."
)

def build_prompt(word: str, definitions: List[str]) -> str:
    print(word)
    return f"""
Input word: {word}
Definitions (raw):
{json.dumps(definitions, ensure_ascii=False)}

Return ONLY strict JSON with this schema:

{{
  "ok": boolean,
  "error": string | null,   // required when ok=false
  "pos": string[],
  "categorySlugs": string[],
  "flags": {{ "adult": boolean, "vulgar": boolean, "offensive": boolean }},
  "senses": {{ "pos": string, "definition": string, "register"?: string, "domains"?: string[] }}[],
  "clueIdeas": {{ "clue": string, "difficulty": 1|2|3|4|5 }}[]
}}

IMPORTANT:
- If you are not confident you can provide GOOD senses/clues based on the given definitions, return:
  {{ "ok": false, "error": "insufficient-evidence" }} (and still include empty arrays + false flags).
- Do NOT guess domains, categories, register, or clues. Better to fail than be wrong.
- clueIdeas max 5. Crossword style. No answer in clue.
- categorySlugs/domains must be kebab-case.
- pos values must be one of: {sorted(ALLOWED_POS)}.
""".strip()

ALLOWED_ERRORS = {
    "insufficient-evidence",
    "ambiguous",
    "non-word",
    "bad-definitions",
    "format-error",
}

def sanitize_llm_output(out: Dict[str, Any]) -> Dict[str, Any]:
    ok = bool(out.get("ok", True))  # backward-compatible if missing
    err = out.get("error", None)
    if err is not None:
        err = str(err).strip() or None
    if (not ok) and (err not in ALLOWED_ERRORS):
        err = "insufficient-evidence"

    # If model says not ok, return empty safe payload
    if not ok:
        return {
            "ok": False,
            "error": err or "insufficient-evidence",
            "pos": [],
            "categorySlugs": [],
            "flags": {"adult": False, "vulgar": False, "offensive": False},
            "senses": [],
            "clueIdeas": [],
        }

    # ----- existing cleaning logic, but add ok/error fields -----
    pos = []
    for p in (out.get("pos") or []):
        p = str(p).strip().lower()
        if p in ALLOWED_POS:
            pos.append(p)
    pos = list(dict.fromkeys(pos))

    cat_slugs = []
    for c in (out.get("categorySlugs") or []):
        sc = slugify(str(c))
        if sc:
            cat_slugs.append(sc)
    cat_slugs = list(dict.fromkeys(cat_slugs))

    flags_in = out.get("flags") or {}
    flags = {
        "adult": bool(flags_in.get("adult", False)),
        "vulgar": bool(flags_in.get("vulgar", False)),
        "offensive": bool(flags_in.get("offensive", False)),
    }

    senses_out = []
    for s in (out.get("senses") or []):
        if not isinstance(s, dict):
            continue
        sp = str(s.get("pos") or "").strip().lower()
        sd = str(s.get("definition") or "").strip()
        if not sp or sp not in ALLOWED_POS or not sd:
            continue
        reg = str(s.get("register") or "").strip() or None
        domains = []
        for d in (s.get("domains") or []):
            dd = slugify(str(d))
            if dd:
                domains.append(dd)
        senses_out.append({
            "senseId": None,
            "pos": sp,
            "definition": sd,
            "register": reg,
            "domains": list(dict.fromkeys(domains)) if domains else [],
            "source": {"name": "llm", "model": MODEL},
        })

    clue_ideas = []
    for ci in (out.get("clueIdeas") or [])[:5]:
        if not isinstance(ci, dict):
            continue
        clue = str(ci.get("clue") or "").strip()
        if not clue:
            continue
        try:
            diff = int(ci.get("difficulty", 3))
        except Exception:
            diff = 3
        diff = max(1, min(5, diff))
        clue_ideas.append({"clue": clue, "difficulty": diff})

    # Cautious gate: if we ended up with basically nothing, fail instead of writing crap
    if (not senses_out) and (not clue_ideas) and (not pos) and (not cat_slugs):
        return {
            "ok": False,
            "error": "insufficient-evidence",
            "pos": [],
            "categorySlugs": [],
            "flags": {"adult": False, "vulgar": False, "offensive": False},
            "senses": [],
            "clueIdeas": [],
        }

    return {
        "ok": True,
        "error": None,
        "pos": pos,
        "categorySlugs": cat_slugs,
        "flags": flags,
        "senses": senses_out,
        "clueIdeas": clue_ideas,
    }
def extract_json(text: str) -> str:
    # Grab the first JSON object block.
    # This handles cases where the model accidentally adds extra text.
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("format-error: no json object found")
    return m.group(0)

def get_llm_client() -> OpenAI:
    client = getattr(_thread_local, "client", None)
    if client is None:
        client = OpenAI(api_key=VLLM_API_KEY, base_url=VLLM_BASE_URL)
        _thread_local.client = client
    return client

def process_word_doc(w: Dict[str, Any]) -> Dict[str, Any]:
    w_ops: List[UpdateOne] = []
    c_ops: List[InsertOne] = []

    defs = (w.get("raw", {}).get("definitions") or [])
    prompt = build_prompt(w["norm"], defs)

    run_at = now()
    client = get_llm_client()

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            top_p=1.0,
            max_tokens=700,
        )

        text = (resp.choices[0].message.content or "").strip()

        # Parse JSON robustly
        try:
            parsed = json.loads(extract_json(text))
        except Exception as je:
            # JSON/format failure
            w_ops.append(UpdateOne(
                {"_id": w["_id"]},
                {
                    "$set": {
                        "enrichment.status": "failed",
                        "enrichment.reason": "json-parse",
                        "enrichment.model": MODEL,
                        "enrichment.lastRunAt": run_at,
                        "updatedAt": run_at,
                    },
                    "$push": {
                        "enrichment.attempts": {
                            "$each": [{
                                "at": run_at,
                                "status": "failed",
                                "reason": "json-parse",
                                "message": str(je)[:2000],
                                "model": MODEL,
                                "rawSnippet": text[:2000],
                            }],
                            "$slice": -20
                        }
                    }
                }
            ))
            return {"w_ops": w_ops, "c_ops": c_ops}

        cleaned = sanitize_llm_output(parsed)
        print(cleaned)
        # Cautious mode: model (or sanitiser) says "not confident"
        if not cleaned.get("ok", True):
            reason = cleaned.get("error") or "insufficient-evidence"
            w_ops.append(UpdateOne(
                {"_id": w["_id"]},
                {
                    "$set": {
                        # choose "rejected" if you don't want to retry automatically
                        "enrichment.status": "rejected",
                        "enrichment.reason": reason,
                        "enrichment.model": MODEL,
                        "enrichment.lastRunAt": run_at,
                        "updatedAt": run_at,
                    },
                    "$push": {
                        "enrichment.attempts": {
                            "$each": [{
                                "at": run_at,
                                "status": "rejected",
                                "reason": reason,
                                "message": None,
                                "model": MODEL,
                            }],
                            "$slice": -20
                        }
                    }
                }
            ))
            return {"w_ops": w_ops, "c_ops": c_ops}

        # SUCCESS: update word
        w_ops.append(UpdateOne(
            {"_id": w["_id"]},
            {
                "$set": {
                    "pos": cleaned["pos"],
                    "categorySlugs": cleaned["categorySlugs"],
                    "flags": cleaned["flags"],
                    "senses": cleaned["senses"],

                    "enrichment.status": "done",
                    "enrichment.reason": None,
                    "enrichment.model": MODEL,
                    "enrichment.lastRunAt": run_at,
                    "enrichment.doneAt": run_at,   # success timestamp
                    "updatedAt": run_at,
                },
                "$push": {
                    "enrichment.attempts": {
                        "$each": [{
                            "at": run_at,
                            "status": "done",
                            "reason": None,
                            "message": None,
                            "model": MODEL,
                            "stats": {
                                "posCount": len(cleaned["pos"] or []),
                                "senseCount": len(cleaned["senses"] or []),
                                "clueCount": len(cleaned["clueIdeas"] or []),
                            }
                        }],
                        "$slice": -20
                    }
                }
            }
        ))

        # Insert clue ideas
        for ci in cleaned["clueIdeas"]:
            c_ops.append(InsertOne({
                "answerId": w["_id"],
                "answerNorm": w["norm"],
                "answerLength": w["length"],
                "clue": ci["clue"],
                "difficulty": ci["difficulty"],
                "style": "straight",
                "isCryptic": False,
                "senseId": None,
                "categorySlugs": cleaned["categorySlugs"],
                "flags": {"adult": cleaned["flags"]["adult"]},
                "quality": {"score": 0.5, "verified": False, "duplicatesOf": None},
                "source": {"name": "llm", "ref": MODEL, "createdBy": "enrich_words_vllm.py"},
                "createdAt": run_at,
                "updatedAt": run_at,
            }))

        return {"w_ops": w_ops, "c_ops": c_ops}

    except Exception as e:
        # Hard failure (network, vLLM down, etc.)
        err_msg = str(e)
        w_ops.append(UpdateOne(
            {"_id": w["_id"]},
            {
                "$set": {
                    "enrichment.status": "failed",
                    "enrichment.reason": "exception",
                    "enrichment.model": MODEL,
                    "enrichment.lastRunAt": run_at,
                    "updatedAt": run_at,
                },
                "$push": {
                    "enrichment.attempts": {
                        "$each": [{
                            "at": run_at,
                            "status": "failed",
                            "reason": "exception",
                            "message": err_msg[:2000],
                            "model": MODEL,
                        }],
                        "$slice": -20
                    }
                }
            }
        ))
        return {"w_ops": w_ops, "c_ops": c_ops}

def enrich(limit: int = 20, concurrency: int = DEFAULT_CONCURRENCY):
    mongo = MongoClient(MONGO_URI)
    words = mongo[DB_NAME][WORDS_COLL]
    clues = mongo[DB_NAME][CLUES_COLL]

    docs = list(words.find({"enrichment.status": "pending"}).limit(limit))
    if not docs:
        print("No pending words.")
        return 0

    w_ops = []
    c_ops = []
    workers = max(1, int(concurrency))
    if workers == 1:
        for w in docs:
            out = process_word_doc(w)
            w_ops.extend(out["w_ops"])
            c_ops.extend(out["c_ops"])
    else:
        print(f"🚀 parallel enrichment with concurrency={workers}")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(process_word_doc, w) for w in docs]
            for fut in as_completed(futures):
                out = fut.result()
                w_ops.extend(out["w_ops"])
                c_ops.extend(out["c_ops"])

    if w_ops:
        words.bulk_write(w_ops, ordered=False)
    if c_ops:
        clues.bulk_write(c_ops, ordered=False)

    print(f"✅ processed {len(docs)} words; inserted {len(c_ops)} clues")
    return len(docs)

if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser()
    parser.add_argument("limit", nargs="?", type=int, default=5)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    args = parser.parse_args()

    limit = args.limit
    concurrency = max(1, int(args.concurrency))

    while True:
        processed = enrich(limit=limit, concurrency=concurrency)

        # enrich() prints "No pending words." and returns None
        if not processed:
            print("🎉 No more pending words. Exiting.")
            break

        # small breather so you don't hammer vLLM
        time.sleep(0.2)
