#!/usr/bin/env python3
"""Build consolidated data.json from NorEval evaluation results.

Reads metrics_setup.yaml and all result JSONs from results/ and
NorOLMo_progress/, extracting prompt-variant aggregation stats
(max, mean, median) for each (model, benchmark, shot) combination.

Output: docs/data.json
"""

import json
import os
import glob
import statistics
from pathlib import Path

import yaml

BASE_DIR = Path(__file__).parent
RESULTS_DIR = BASE_DIR / "results"
PROGRESS_DIR = BASE_DIR / "NorOLMo_progress"
OUTPUT_FILE = BASE_DIR / "docs" / "data.json"

SHOT_SETTINGS = ["0", "1", "5"]
SHOT_DIRS = {"0": "0-shot", "1": "1-shot", "5": "5-shot"}

# Pretty display names for known models (fallback: directory name)
MODEL_DISPLAY_NAMES = {
    "norolmo-13b": "NorOLMo 13B",
    "normistral-7b-warm": "NorMistral 7B",
    "normistral-11b-warm": "NorMistral 11B",
    "normistral-11b-long": "NorMistral 11B Long",
    "olmo-2-13b (stage 1)": "OLMo-2 13B (stage 1)",
}

# Models displayed by default (others unchecked until user enables them)
DEFAULT_MODELS = [
    "norolmo-13b",
    "normistral-7b-warm",
    "normistral-11b-warm",
    "normistral-11b-long",
    "olmo-2-13b (stage 1)",
]

# Task groups for visual pairing (two bars/lines per model)
TASK_GROUPS = {
    "multiple-choice QA (commonsense)": {
        "benchmarks": ["norcommonsenseqa_nob", "norcommonsenseqa_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "reading comprehension (openbookqa)": {
        "benchmarks": ["noropenbookqa_nob", "noropenbookqa_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "multiple-choice QA (openbookqa)": {
        "benchmarks": ["noropenbookqa_no_fact_nob", "noropenbookqa_no_fact_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "multiple-choice QA (truthfulqa)": {
        "benchmarks": ["nortruthfulqa_mc_nob", "nortruthfulqa_mc_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "generative QA (truthfulqa)": {
        "benchmarks": ["nortruthfulqa_gen_nob", "nortruthfulqa_gen_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "multiple-choice QA (nrk-quiz)": {
        "benchmarks": ["nrk_quiz_qa_nob", "nrk_quiz_qa_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "idiom completion": {
        "benchmarks": ["noridiom_nob", "noridiom_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "summarization (norsumm)": {
        "benchmarks": ["norsumm_nob", "norsumm_nno"],
        "labels": ["Bokmål", "Nynorsk"],
    },
    "translation (English↔Bokmål)": {
        "benchmarks": ["tatoeba_nob_eng", "tatoeba_eng_nob"],
        "labels": ["Bokmål→English", "English→Bokmål"],
    },
    "translation (English↔Nynorsk)": {
        "benchmarks": ["tatoeba_nno_eng", "tatoeba_eng_nno"],
        "labels": ["Nynorsk→English", "English→Nynorsk"],
    },
    "translation (Bokmål↔Sámi)": {
        "benchmarks": ["tatoeba_nob_sme", "tatoeba_sme_nob"],
        "labels": ["Bokmål→Sámi", "Sámi→Bokmål"],
    },
    "translation (Bokmål↔Nynorsk)": {
        "benchmarks": ["norsumm_nob_nno_translation", "norsumm_nno_nob_translation"],
        "labels": ["Bokmål→Nynorsk", "Nynorsk→Bokmål"],
    },
}

# Benchmarks that are NOT part of any group (shown as single bars)
STANDALONE_BENCHMARKS = [
    "norbelebele",
    "norquad",
    "norec_sentence",
    "norec_document",
    "norsummarize_instruct",
    "norrewrite_instruct",
    "ask_gec",
    "ncb",
    "nocola",
    "slide",
]


def load_metrics_setup():
    with open(BASE_DIR / "metrics_setup.yaml") as f:
        return yaml.safe_load(f)


def find_latest_results_json(directory):
    """Find the newest results_*.json file under directory (recursive)."""
    pattern = os.path.join(directory, "**", "results_*.json")
    files = glob.glob(pattern, recursive=True)
    if not files:
        return None
    files.sort(key=lambda f: os.path.basename(f))
    return files[-1]


def extract_benchmark_scores(results_json_path, benchmark_name, main_metric):
    """Extract max/mean/median of main_metric across all prompt variants.

    Returns dict {"max": ..., "mean": ..., "median": ...} or None.
    """
    with open(results_json_path) as f:
        data = json.load(f)

    metric_key = f"{main_metric},none"
    results = data.get("results", {})

    values = []
    for task_key, task_results in results.items():
        if task_key == benchmark_name or task_key.startswith(f"{benchmark_name}_p"):
            if metric_key in task_results:
                val = task_results[metric_key]
                if isinstance(val, (int, float)):
                    values.append(val)

    if not values:
        return None
    return {
        "max": round(max(values), 6),
        "mean": round(statistics.mean(values), 6),
        "median": round(statistics.median(values), 6),
    }


def process_model_dir(model_path, metrics_setup):
    """Process a single model/checkpoint directory, returning scores dict."""
    scores = {}
    for benchmark, config in metrics_setup.items():
        main_metric = config["main_metric"]
        bench_scores = {}
        for shot_key, shot_dir_name in SHOT_DIRS.items():
            shot_path = os.path.join(model_path, benchmark, shot_dir_name)
            if not os.path.isdir(shot_path):
                continue
            results_file = find_latest_results_json(shot_path)
            if results_file is None:
                continue
            agg = extract_benchmark_scores(results_file, benchmark, main_metric)
            if agg is not None:
                bench_scores[shot_key] = agg
        if bench_scores:
            scores[benchmark] = bench_scores
    return scores


def build_metrics_info(metrics_setup):
    """Build the metrics_setup section for data.json."""
    info = {}
    for benchmark, config in metrics_setup.items():
        max_perf = 100.0 if config.get("metric_scale") == "percent" else 1.0
        info[benchmark] = {
            "pretty_name": config["pretty_name"],
            "description": config.get("description", ""),
            "main_metric": config["main_metric"],
            "random_baseline": config["random_baseline"],
            "max_performance": max_perf,
            "category": config.get("category", "Uncategorized"),
            "evaluation_type": config.get("evaluation_type", ""),
            "metric_scale": config.get("metric_scale", "unit"),
        }
    return info


def main():
    metrics_setup = load_metrics_setup()

    os.makedirs(OUTPUT_FILE.parent, exist_ok=True)

    # Process models in results/
    models = {}
    if RESULTS_DIR.is_dir():
        for model_dir in sorted(os.listdir(RESULTS_DIR)):
            model_path = RESULTS_DIR / model_dir
            if not model_path.is_dir():
                continue
            print(f"Processing model: {model_dir}")
            scores = process_model_dir(str(model_path), metrics_setup)
            models[model_dir] = scores

    # Process checkpoints in NorOLMo_progress/
    progress = {}
    if PROGRESS_DIR.is_dir():
        for ckpt_dir in sorted(os.listdir(PROGRESS_DIR)):
            ckpt_path = PROGRESS_DIR / ckpt_dir
            if not ckpt_path.is_dir():
                continue
            parts = ckpt_dir.split("-")
            step_str = parts[-1] if parts else ""
            if not step_str.isdigit():
                continue
            step = int(step_str)
            print(f"Processing checkpoint: step {step}")
            scores = process_model_dir(str(ckpt_path), metrics_setup)
            progress[step] = scores

    # Language benchmark lists
    nno_benchmarks = [b for b in metrics_setup if "_nno" in b]
    sme_benchmarks = [b for b in metrics_setup if "_sme" in b]
    nob_nno_translation_benchmarks = [
        "norsumm_nob_nno_translation",
        "norsumm_nno_nob_translation",
    ]

    # Build output
    output = {
        "metrics_setup": build_metrics_info(metrics_setup),
        "task_groups": TASK_GROUPS,
        "standalone_benchmarks": STANDALONE_BENCHMARKS,
        "nno_benchmarks": sorted(nno_benchmarks),
        "sme_benchmarks": sorted(sme_benchmarks),
        "nob_nno_translation_benchmarks": sorted(nob_nno_translation_benchmarks),
        "model_display_names": MODEL_DISPLAY_NAMES,
        "default_models": DEFAULT_MODELS,
        "models": models,
        "progress": progress,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"\nWritten {OUTPUT_FILE} ({size_kb:.1f} KB)")
    print(f"  Models: {list(models.keys())}")
    print(f"  Checkpoints: {sorted(progress.keys())}")
    print(f"  Benchmarks per model: {len(metrics_setup)}")


if __name__ == "__main__":
    main()
