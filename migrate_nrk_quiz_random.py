#!/usr/bin/env python3
"""
Converts nrk_quiz_qa_random_{nob,nno} results to nrk_quiz_qa_{nob,nno} format.

For each model in results/:
- If nrk_quiz_qa_random_nob or nrk_quiz_qa_random_nno are missing, prints a warning.
- If present, copies results_*.json files into nrk_quiz_qa_{nob,nno}/ with all
  "nrk_quiz_qa_random_nob" -> "nrk_quiz_qa_nob" (and nno equivalent) replacements applied.

Only results_*.json files are copied (not samples_*.jsonl), since those are what
build_data.py uses. The random benchmark uses non-randomized few-shot examples that
are now deprecated; the _random variants use the current randomized few-shotting.
"""

import os

RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")

PAIRS = [
    ("nrk_quiz_qa_random_nob", "nrk_quiz_qa_nob"),
    ("nrk_quiz_qa_random_nno", "nrk_quiz_qa_nno"),
]


def process_results_file(src_path, dst_path, old_name, new_name):
    with open(src_path, "r", encoding="utf-8") as f:
        content = f.read()
    content = content.replace(old_name, new_name)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    model_dirs = sorted(os.listdir(RESULTS_DIR))

    for model_dir in model_dirs:
        model_path = os.path.join(RESULTS_DIR, model_dir)
        if not os.path.isdir(model_path):
            continue

        for random_bench, canonical_bench in PAIRS:
            random_path = os.path.join(model_path, random_bench)
            canonical_path = os.path.join(model_path, canonical_bench)

            if not os.path.isdir(random_path):
                print(f"WARNING: {model_dir!r}: missing {random_bench}/")
                continue

            created = 0
            for shot_dir in sorted(os.listdir(random_path)):
                shot_path = os.path.join(random_path, shot_dir)
                if not os.path.isdir(shot_path):
                    continue
                for model_sanitized_dir in sorted(os.listdir(shot_path)):
                    src_dir = os.path.join(shot_path, model_sanitized_dir)
                    if not os.path.isdir(src_dir):
                        continue
                    for fname in sorted(os.listdir(src_dir)):
                        if not (fname.startswith("results_") and fname.endswith(".json")):
                            continue
                        src_file = os.path.join(src_dir, fname)
                        dst_file = os.path.join(
                            canonical_path, shot_dir, model_sanitized_dir, fname
                        )
                        process_results_file(src_file, dst_file, random_bench, canonical_bench)
                        created += 1

            print(f"OK: {model_dir!r}: {created} file(s) written ({random_bench} -> {canonical_bench})")


if __name__ == "__main__":
    main()
