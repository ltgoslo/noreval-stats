#!/usr/bin/env python3
"""Build consolidated data.json from NorEval evaluation results.

Reads metrics_setup.yaml and all result JSONs from results/ and
NorOLMo_progress/, extracting prompt-variant aggregation stats
(max, mean, median) for each (model, benchmark, shot) combination.

Output: docs/data.json
"""

import json
import math
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


def load_models_setup():
    """Load model metadata from models_setup.yaml.

    Returns dicts derived from the YAML:
    (display_names, categories, organizations, parameters,
     default_models, color_map, model_info)
    """
    yaml_path = BASE_DIR / "models_setup.yaml"
    with open(yaml_path) as f:
        raw = yaml.safe_load(f)

    display_names = {}
    categories = {}
    organizations = {}
    parameters = {}
    default_models = []
    color_map = {}
    model_info = {}

    for model_dir, cfg in raw.items():
        display_names[model_dir] = cfg.get("display_name", model_dir)
        categories[model_dir] = cfg.get("category", "multilingual")
        organizations[model_dir] = cfg.get("organization", "")
        parameters[model_dir] = cfg.get("parameters", 0)
        if cfg.get("default"):
            default_models.append(model_dir)
        if cfg.get("color"):
            color_map[model_dir] = cfg["color"]
        desc = cfg.get("description", "")
        url = cfg.get("huggingface_url", "")
        if desc or url:
            model_info[model_dir] = {
                "description": desc,
                "huggingface_url": url,
            }

    return (display_names, categories, organizations, parameters,
            default_models, color_map, model_info)

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
    "noreval_multiblimp",
    "slide",
]


# Metrics to exclude globally from the metric selector
EXCLUDED_METRICS = {"bleu_diff", "rouge1_diff", "rouge2_diff", "rougeL_diff"}

# Per-benchmark metric exclusions
EXCLUDED_METRICS_PER_BENCHMARK = {
    "ask_gec": {"exact_match"},
    "noreval_multiblimp": {"acc_norm"},
}


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


def _get_stderr(task_results, metric_name, n_samples, metric_scale):
    """Get stderr for a metric from task results, estimating if missing.

    Returns float or None.
    """
    stderr_key = f"{metric_name}_stderr,none"
    se = task_results.get(stderr_key)
    if isinstance(se, (int, float)):
        return se
    # stderr is "N/A" or missing — estimate from metric value and sample count
    if n_samples and n_samples > 1:
        val_key = f"{metric_name},none"
        val = task_results.get(val_key)
        if isinstance(val, (int, float)):
            if metric_scale == "percent":
                # val is on 0-100 scale; convert to 0-1, compute, convert back
                p = max(0.0, min(1.0, val / 100.0))
                if p > 0 and p < 1:
                    return math.sqrt(p * (1 - p) / n_samples) * 100
            else:
                p = max(0.0, min(1.0, val))
                if p > 0 and p < 1:
                    return math.sqrt(p * (1 - p) / n_samples)
    return None


def extract_benchmark_scores(
    results_json_path, benchmark_name, subtasks=None, metrics_setup_entry=None
):
    """Extract max/mean/median of all non-stderr metrics across prompt variants.

    For benchmarks with subtasks (e.g. noreval_multiblimp), also extracts
    per-subtask metrics as virtual metric names like "acc: Person: 1→2".

    Returns dict {metric_name: {"max": ..., "mean": ..., "median": ..., "min": ...,
                                 "max_stderr": ..., ...}, ...}
    or None if no metrics found.
    """
    with open(results_json_path) as f:
        data = json.load(f)

    results = data.get("results", {})
    n_samples_dict = data.get("n-samples", {})
    bench_exclusions = EXCLUDED_METRICS | EXCLUDED_METRICS_PER_BENCHMARK.get(
        benchmark_name, set()
    )
    metric_scale = (
        metrics_setup_entry.get("metric_scale", "unit")
        if metrics_setup_entry
        else "unit"
    )

    # Collect (value, stderr) pairs per metric across prompt variants
    metric_values = {}  # metric_name -> list of (value, stderr_or_None)
    for task_key, task_results in results.items():
        if task_key == benchmark_name or task_key.startswith(f"{benchmark_name}_p"):
            # Get sample count for this task key
            ns_entry = n_samples_dict.get(task_key, {})
            n_samples = ns_entry.get("effective") or ns_entry.get("original")

            for key, val in task_results.items():
                if not key.endswith(",none"):
                    continue
                if "_stderr,none" in key:
                    continue
                metric_name = key[: -len(",none")]
                if metric_name in bench_exclusions:
                    continue
                if isinstance(val, (int, float)):
                    se = _get_stderr(task_results, metric_name, n_samples, metric_scale)
                    if metric_name not in metric_values:
                        metric_values[metric_name] = []
                    metric_values[metric_name].append((val, se))

    # Extract subtask metrics (e.g. MultiBLiMP per-phenomenon scores)
    if subtasks:
        for subtask_code, subtask_info in subtasks.items():
            subtask_key = f"{benchmark_name}_{subtask_code}"
            if subtask_key not in results:
                continue
            task_results = results[subtask_key]
            pretty_name = subtask_info["pretty_name"]
            ns_entry = n_samples_dict.get(subtask_key, {})
            n_samples = ns_entry.get("effective") or ns_entry.get("original")
            for key, val in task_results.items():
                if not key.endswith(",none"):
                    continue
                if "_stderr,none" in key:
                    continue
                base_metric = key[: -len(",none")]
                if base_metric in bench_exclusions:
                    continue
                if isinstance(val, (int, float)):
                    se = _get_stderr(
                        task_results, base_metric, n_samples, metric_scale
                    )
                    # Create a virtual metric name: "acc: Person: 1→2"
                    virtual_name = f"{base_metric}: {pretty_name}"
                    if virtual_name not in metric_values:
                        metric_values[virtual_name] = []
                    metric_values[virtual_name].append((val, se))

    if not metric_values:
        return None

    out = {}
    for metric_name, pairs in metric_values.items():
        values = [v for v, _ in pairs]
        stderrs = [se for _, se in pairs]

        entry = {
            "max": round(max(values), 6),
            "mean": round(statistics.mean(values), 6),
            "median": round(statistics.median(values), 6),
            "min": round(min(values), 6),
        }

        # max_stderr: stderr of the variant that achieved the max score
        max_idx = values.index(max(values))
        entry["max_prompt_idx"] = max_idx
        if stderrs[max_idx] is not None:
            entry["max_stderr"] = round(stderrs[max_idx], 6)

        # min_stderr: stderr of the variant that achieved the min score
        min_idx = values.index(min(values))
        if stderrs[min_idx] is not None:
            entry["min_stderr"] = round(stderrs[min_idx], 6)

        # mean_stderr: sqrt(sum(se^2)) / n  (error propagation for mean)
        if all(se is not None for se in stderrs):
            n = len(stderrs)
            mean_se = math.sqrt(sum(se**2 for se in stderrs)) / n
            entry["mean_stderr"] = round(mean_se, 6)

        # median_stderr: stderr of the variant closest to the median
        med = statistics.median(values)
        closest_idx = min(range(len(values)), key=lambda i: abs(values[i] - med))
        if stderrs[closest_idx] is not None:
            entry["median_stderr"] = round(stderrs[closest_idx], 6)

        # Prompt-variant spread (for prompt deviation error bars)
        entry["n_prompts"] = len(values)
        if len(values) >= 2:
            entry["prompt_sd"] = round(statistics.stdev(values), 6)
            med_val = statistics.median(values)
            entry["prompt_mad"] = round(
                statistics.median([abs(v - med_val) for v in values]), 6
            )
        else:
            entry["prompt_sd"] = 0.0
            entry["prompt_mad"] = 0.0

        out[metric_name] = entry
    return out


def process_model_dir(model_path, metrics_setup):
    """Process a single model/checkpoint directory, returning scores dict.

    Returns (scores, discovered_metrics) where discovered_metrics is
    {benchmark: set_of_metric_names}.
    """
    scores = {}
    discovered_metrics = {}
    for benchmark, config in metrics_setup.items():
        subtasks = config.get("subtasks")
        bench_scores = {}
        for shot_key, shot_dir_name in SHOT_DIRS.items():
            shot_path = os.path.join(model_path, benchmark, shot_dir_name)
            if not os.path.isdir(shot_path):
                continue
            results_file = find_latest_results_json(shot_path)
            if results_file is None:
                continue
            agg = extract_benchmark_scores(
                results_file, benchmark, subtasks, config
            )
            if agg is not None:
                bench_scores[shot_key] = agg
                if benchmark not in discovered_metrics:
                    discovered_metrics[benchmark] = set()
                discovered_metrics[benchmark].update(agg.keys())
        if bench_scores:
            scores[benchmark] = bench_scores
    return scores, discovered_metrics


def build_metrics_info(metrics_setup, discovered_metrics):
    """Build the metrics_setup section for data.json."""
    info = {}
    for benchmark, config in metrics_setup.items():
        max_perf = 100.0 if config.get("metric_scale") == "percent" else 1.0
        main_metric = config["main_metric"]
        # Build available_metrics list: main_metric first, then others sorted
        disc = discovered_metrics.get(benchmark, set())
        # Separate base metrics from subtask metrics (contain ": ")
        base_metrics = {m for m in disc if ": " not in m}
        subtask_metrics = sorted(m for m in disc if ": " in m)
        base_others = sorted(base_metrics - {main_metric})
        available_metrics = (
            ([main_metric] if main_metric in disc else [])
            + base_others
            + subtask_metrics
        )
        if not available_metrics:
            available_metrics = sorted(disc)

        entry = {
            "pretty_name": config["pretty_name"],
            "description": config.get("description", ""),
            "main_metric": main_metric,
            "random_baseline": config["random_baseline"],
            "max_performance": max_perf,
            "category": config.get("category", "Uncategorized"),
            "evaluation_type": config.get("evaluation_type", ""),
            "metric_scale": config.get("metric_scale", "unit"),
            "url": config.get("url", ""),
            "available_metrics": available_metrics,
        }

        # Include subtask metadata for frontend tooltips/descriptions
        subtasks = config.get("subtasks")
        if subtasks:
            entry["subtasks"] = {
                code: {
                    "pretty_name": st["pretty_name"],
                    "description": st.get("description", ""),
                }
                for code, st in subtasks.items()
            }

        info[benchmark] = entry
    return info


def main():
    metrics_setup = load_metrics_setup()
    (MODEL_DISPLAY_NAMES, MODEL_CATEGORIES, MODEL_ORGANIZATIONS,
     MODEL_PARAMETERS, DEFAULT_MODELS, MODEL_COLOR_MAP,
     MODEL_INFO) = load_models_setup()

    os.makedirs(OUTPUT_FILE.parent, exist_ok=True)

    # Process models in results/
    models = {}
    all_discovered_metrics = {}  # benchmark -> set of metric names
    if RESULTS_DIR.is_dir():
        for model_dir in sorted(os.listdir(RESULTS_DIR)):
            model_path = RESULTS_DIR / model_dir
            if not model_path.is_dir():
                continue
            print(f"Processing model: {model_dir}")
            scores, disc = process_model_dir(str(model_path), metrics_setup)
            models[model_dir] = scores
            for bench, mset in disc.items():
                if bench not in all_discovered_metrics:
                    all_discovered_metrics[bench] = set()
                all_discovered_metrics[bench].update(mset)

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
            scores, disc = process_model_dir(str(ckpt_path), metrics_setup)
            progress[step] = scores
            for bench, mset in disc.items():
                if bench not in all_discovered_metrics:
                    all_discovered_metrics[bench] = set()
                all_discovered_metrics[bench].update(mset)

    # Language benchmark lists
    nno_benchmarks = [b for b in metrics_setup if "_nno" in b]
    sme_benchmarks = [b for b in metrics_setup if "_sme" in b] + ["noreval_multiblimp"]
    nob_nno_translation_benchmarks = [
        "norsumm_nob_nno_translation",
        "norsumm_nno_nob_translation",
    ]

    # Benchmarks that belong to both Bokmål and Nynorsk
    shared_language_benchmarks = ["slide"]

    # Build output
    output = {
        "metrics_setup": build_metrics_info(metrics_setup, all_discovered_metrics),
        "task_groups": TASK_GROUPS,
        "standalone_benchmarks": STANDALONE_BENCHMARKS,
        "nno_benchmarks": sorted(nno_benchmarks),
        "sme_benchmarks": sorted(sme_benchmarks),
        "nob_nno_translation_benchmarks": sorted(nob_nno_translation_benchmarks),
        "shared_language_benchmarks": shared_language_benchmarks,
        "model_display_names": MODEL_DISPLAY_NAMES,
        "model_categories": MODEL_CATEGORIES,
        "model_organizations": MODEL_ORGANIZATIONS,
        "model_parameters": MODEL_PARAMETERS,
        "model_colors": MODEL_COLOR_MAP,
        "model_info": MODEL_INFO,
        "default_models": DEFAULT_MODELS,
        "models": models,
        "progress": progress,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, ensure_ascii=False)

    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"\nWritten {OUTPUT_FILE} ({size_kb:.1f} KB)")
    print(f"  Models: {list(models.keys())}")
    print(f"  Checkpoints: {sorted(progress.keys())}")
    print(f"  Benchmarks per model: {len(metrics_setup)}")


if __name__ == "__main__":
    main()
