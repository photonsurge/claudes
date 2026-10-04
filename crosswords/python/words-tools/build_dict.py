import json
import re
import sys
from collections import defaultdict

IN_PATH = sys.argv[1] if len(sys.argv) > 1 else "out/raw.jsonl"
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else "out/en_singleword_dict.jsonl"

# Single word only:
# - no spaces
# - no control chars
# - keep letters/marks + apostrophe + hyphen (tweak if you want)
# Note: Python stdlib `re` doesn't support `\p{L}` Unicode properties.
# We enforce this via `is_single_word` below instead of a regex.

def is_single_word(word: str) -> bool:
    if not word or not isinstance(word, str):
        return False
    w = word.strip()
    if not w:
        return False
    if " " in w or "\t" in w or "\n" in w:
        return False
    # Python stdlib re doesn't support \p{L} without "regex" module.
    # So we do a more practical filter:
    # keep alphabetic + combining marks + ' + -
    for ch in w:
        if ch.isalpha() or ch in ("'", "-") or (0x300 <= ord(ch) <= 0x36F):  # combining marks range
            continue
        return False
    if w.startswith("-") or w.endswith("-"):
        return False
    return True

def norm_pos(entry: dict) -> str:
    p = (entry.get("pos") or entry.get("part_of_speech") or "").strip().lower()
    return p

def dedupe_preserve(items):
    seen = set()
    out = []
    for x in items:
        k = json.dumps(x, sort_keys=True, ensure_ascii=False) if isinstance(x, (dict, list)) else x
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out

def extract_pronunciations(entry: dict):
    """
    Wiktextract commonly outputs 'sounds': list of dicts like:
      {"ipa": "...", "audio": "...", "tags": [...], "region": "..."}
    Sometimes 'pronunciations' exists depending on version.
    We'll normalize to a list of dicts.
    """
    res = []
    sounds = entry.get("sounds")
    if isinstance(sounds, list):
        for s in sounds:
            if not isinstance(s, dict):
                continue
            item = {}
            for k in ("ipa", "audio", "ogg_url", "mp3_url", "tags", "note", "region", "accent"):
                if k in s and s[k]:
                    item[k] = s[k]
            if item:
                res.append(item)

    pron = entry.get("pronunciations")
    if isinstance(pron, list):
        for p in pron:
            if isinstance(p, dict):
                res.append(p)
    return dedupe_preserve(res)

def extract_forms(entry: dict):
    """
    Wiktextract often has 'forms': list[dict] with keys like:
      {"form": "ran", "tags": ["past"], ...}
    """
    res = []
    forms = entry.get("forms")
    if isinstance(forms, list):
        for f in forms:
            if not isinstance(f, dict):
                continue
            form = f.get("form") or f.get("word")
            if isinstance(form, str) and form.strip():
                item = {"form": form.strip()}
                tags = f.get("tags")
                if isinstance(tags, list) and tags:
                    item["tags"] = tags
                # sometimes "sense", "source", "alt" exists
                for k in ("sense", "source", "roman", "transliteration"):
                    if k in f and f[k]:
                        item[k] = f[k]
                res.append(item)
    return dedupe_preserve(res)

def extract_etymology_text(entry: dict) -> str | None:
    # Common keys: "etymology_text", "etymology"
    for k in ("etymology_text", "etymology"):
        v = entry.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None

def extract_categories_and_tags(entry: dict):
    cats = entry.get("categories")
    tags = entry.get("tags")
    out_cats = cats if isinstance(cats, list) else []
    out_tags = tags if isinstance(tags, list) else []
    return (dedupe_preserve(out_cats), dedupe_preserve(out_tags))

def extract_senses(entry: dict):
    """
    Normalize to:
      [{"definition": "...", "examples":[...], "labels":[...], "tags":[...]}]
    """
    senses_out = []

    senses = entry.get("senses")
    if isinstance(senses, list):
        for s in senses:
            if not isinstance(s, dict):
                continue

            # definition/gloss
            defs = []
            glosses = s.get("glosses")
            if isinstance(glosses, list):
                defs.extend([g.strip() for g in glosses if isinstance(g, str) and g.strip()])
            d = s.get("definition")
            if isinstance(d, str) and d.strip():
                defs.append(d.strip())

            defs = [x for x in dedupe_preserve(defs) if x]

            # examples
            examples_out = []
            ex = s.get("examples")
            if isinstance(ex, list):
                for e in ex:
                    if isinstance(e, str) and e.strip():
                        examples_out.append({"text": e.strip()})
                    elif isinstance(e, dict):
                        item = {}
                        if isinstance(e.get("text"), str) and e["text"].strip():
                            item["text"] = e["text"].strip()
                        if isinstance(e.get("translation"), str) and e["translation"].strip():
                            item["translation"] = e["translation"].strip()
                        if isinstance(e.get("ref"), str) and e["ref"].strip():
                            item["ref"] = e["ref"].strip()
                        if item:
                            examples_out.append(item)

            # labels/tags
            labels = s.get("labels")
            tags = s.get("tags")
            labels_out = labels if isinstance(labels, list) else []
            tags_out = tags if isinstance(tags, list) else []

            for definition in defs:
                obj = {"definition": definition}
                if examples_out:
                    obj["examples"] = dedupe_preserve(examples_out)
                if labels_out:
                    obj["labels"] = dedupe_preserve(labels_out)
                if tags_out:
                    obj["tags"] = dedupe_preserve(tags_out)

                # Sometimes topics / categories at sense-level
                topic = s.get("topics")
                if isinstance(topic, list) and topic:
                    obj["topics"] = dedupe_preserve(topic)

                senses_out.append(obj)

    # Fallback (rare): 'definitions'
    if not senses_out:
        defs = entry.get("definitions")
        if isinstance(defs, list):
            for d in defs:
                if isinstance(d, str) and d.strip():
                    senses_out.append({"definition": d.strip()})

    return dedupe_preserve(senses_out)

def main():
    # aggregate across multiple etymologies/sections for same word+pos
    agg = defaultdict(lambda: {
        "word": None,
        "lang": "en",
        "pos": None,
        "pronunciations": [],
        "forms": [],
        "senses": [],
        "etymology_text": None,
        "categories": [],
        "tags": [],
    })

    processed = 0
    kept = 0

    with open(IN_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            processed += 1

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            word = entry.get("word") or entry.get("title")
            if not isinstance(word, str):
                continue
            word = word.strip()

            if not is_single_word(word):
                continue

            pos = norm_pos(entry)
            if not pos:
                continue

            key = (word, pos)
            out = agg[key]
            out["word"] = word
            out["pos"] = pos

            out["pronunciations"].extend(extract_pronunciations(entry))
            out["forms"].extend(extract_forms(entry))
            out["senses"].extend(extract_senses(entry))

            ety = extract_etymology_text(entry)
            # keep the first etymology text we see (or append if you prefer)
            if ety and not out["etymology_text"]:
                out["etymology_text"] = ety

            cats, tags = extract_categories_and_tags(entry)
            out["categories"].extend(cats)
            out["tags"].extend(tags)

            if processed % 200000 == 0:
                print(f"processed={processed:,} keys={len(agg):,}", file=sys.stderr)

    with open(OUT_PATH, "w", encoding="utf-8") as out_f:
        for (word, pos), obj in agg.items():
            # clean/dedupe
            obj["pronunciations"] = dedupe_preserve(obj["pronunciations"])
            obj["forms"] = dedupe_preserve(obj["forms"])
            obj["senses"] = dedupe_preserve(obj["senses"])
            obj["categories"] = dedupe_preserve(obj["categories"])
            obj["tags"] = dedupe_preserve(obj["tags"])

            # only keep if it has at least 1 definition
            if not obj["senses"]:
                continue

            out_f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            kept += 1

    print(f"Wrote {OUT_PATH} entries={kept:,}", file=sys.stderr)

if __name__ == "__main__":
    main()
