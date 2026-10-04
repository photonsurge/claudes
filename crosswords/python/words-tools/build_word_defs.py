#!/usr/bin/env python3
import argparse
import gzip
import json
from collections import defaultdict


UK_MARKERS = (
    "uk",
    "u.k.",
    "british",
    "britain",
    "england",
    "scotland",
    "wales",
    "ireland",
)


def has_uk_marker(values):
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.lower()
        if any(marker in text for marker in UK_MARKERS):
            return True
    return False


def open_jsonl(path: str):
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")



def dedupe_keep_order(items):
    out = []
    seen = set()
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def main():
    parser = argparse.ArgumentParser(
        description="Build a simple English word->definitions JSONL dump from wiktextract raw output."
    )
    parser.add_argument("input", help="Input raw JSONL file")
    parser.add_argument("output", help="Output JSONL file")
    parser.add_argument(
        "--uk-only",
        action="store_true",
        help="Keep only senses tagged/categorized as UK/British",
    )
    parser.add_argument(
        "--single-token-only",
        action="store_true",
        help="Keep only words without spaces or apostrophes",
    )
    args = parser.parse_args()

    word_defs = defaultdict(list)
    processed = 0
    kept = 0

    with open_jsonl(args.input) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            processed += 1

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("lang_code") != "en" and entry.get("lang") != "English":
                continue

            word = entry.get("word")
            if not isinstance(word, str):
                continue
            word = word.strip()
            if not word:
                continue
            if args.single_token_only and (" " in word or "'" in word):
                continue

            senses = entry.get("senses")
            if not isinstance(senses, list):
                continue

            entry_categories = entry.get("categories")
            if not isinstance(entry_categories, list):
                entry_categories = []

            for sense in senses:
                if not isinstance(sense, dict):
                    continue

                glosses = []
                g = sense.get("glosses")
                if isinstance(g, list):
                    glosses.extend(
                        text.strip() for text in g if isinstance(text, str) and text.strip()
                    )
                rg = sense.get("raw_glosses")
                if isinstance(rg, list):
                    glosses.extend(
                        text.strip() for text in rg if isinstance(text, str) and text.strip()
                    )
                d = sense.get("definition")
                if isinstance(d, str) and d.strip():
                    glosses.append(d.strip())

                glosses = dedupe_keep_order(glosses)
                if not glosses:
                    continue

                if args.uk_only:
                    tags = sense.get("tags")
                    if not isinstance(tags, list):
                        tags = []
                    labels = sense.get("labels")
                    if not isinstance(labels, list):
                        labels = []
                    scats = sense.get("categories")
                    if not isinstance(scats, list):
                        scats = []
                    uk_meta = list(tags) + list(labels) + list(scats) + list(entry_categories)
                    if not has_uk_marker(uk_meta):
                        continue

                for definition in glosses:
                    word_defs[word].append(definition)
                    kept += 1

    with open(args.output, "w", encoding="utf-8") as out:
        for word in sorted(word_defs.keys()):
            definitions = dedupe_keep_order(word_defs[word])
            if not definitions:
                continue
            out.write(json.dumps({"word": word, "definitions": definitions}, ensure_ascii=False) + "\n")

    print(
        f"processed={processed:,} definition_rows={kept:,} unique_words={len(word_defs):,} output={args.output}"
    )


if __name__ == "__main__":
    main()
