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
    # Norwegian models
    "norolmo-13b": "NorOLMo 13B",
    "norolmo-13b-stage1": "NorOLMo 13B (stage 1)",
    "normistral-7b-warm": "NorMistral 7B",
    "normistral-11b-warm": "NorMistral 11B",
    "normistral-11b-long": "NorMistral 11B Long",
    "norbert4-xlarge": "NorBERT4 1B",
    "olmo-2-13b (stage 1)": "OLMo2 13B (stage 1)",
    "Apertus-8B-2509": "Apertus 8B",
    "NorGPT-3B": "NorwAI NorGPT 3B",
    "NorLlama-3B": "NorwAI NorLlama 8B",
    "NorwAI-Mistral-7B": "NorwAI Mistral 7B",
    "NorwAI-Mixtral-8x7B": "NorwAI Mixtral 8x7B",
    "nb-gpt-j-6B": "NB-GPT-J 6B",
    # Multilingual models
    "EuroLLM-22B-2512": "EuroLLM 22B",
    "EuroLLM-9B-2512": "EuroLLM 9B",
    "gemma-3-12b-pt": "Gemma3 12B",
    "gemma-3-27b-pt": "Gemma3 27B",
    "Llama-3.1-8B": "Llama3.1 8B",
    "Mistral-7B-v0.1": "Mistral 7B",
    "Mistral-Nemo-Base-2407": "Mistral 12B",
    "OLMo-2-1124-13B": "OLMo2 13B",
    "Olmo-3-1025-7B": "OLMo3 7B",
    "Olmo-3-1125-32B": "OLMo3 32B",
    "Qwen3-14B": "Qwen3 14B",
    "Qwen3-32B": "Qwen3 32B",
    "Qwen3-8B": "Qwen3 8B",
}

# Model category: "norwegian" or "multilingual"
MODEL_CATEGORIES = {
    "norolmo-13b": "norwegian",
    "norolmo-13b-stage1": "norwegian",
    "normistral-7b-warm": "norwegian",
    "normistral-11b-warm": "norwegian",
    "normistral-11b-long": "norwegian",
    "norbert4-xlarge": "norwegian",
    "olmo-2-13b (stage 1)": "multilingual",
    "Apertus-8B-2509": "multilingual",
    "NorGPT-3B": "norwegian",
    "NorLlama-3B": "norwegian",
    "NorwAI-Mistral-7B": "norwegian",
    "NorwAI-Mixtral-8x7B": "norwegian",
    "nb-gpt-j-6B": "norwegian",
    "EuroLLM-22B-2512": "multilingual",
    "EuroLLM-9B-2512": "multilingual",
    "gemma-3-12b-pt": "multilingual",
    "gemma-3-27b-pt": "multilingual",
    "Llama-3.1-8B": "multilingual",
    "Mistral-7B-v0.1": "multilingual",
    "Mistral-Nemo-Base-2407": "multilingual",
    "OLMo-2-1124-13B": "multilingual",
    "Olmo-3-1025-7B": "multilingual",
    "Olmo-3-1125-32B": "multilingual",
    "Qwen3-14B": "multilingual",
    "Qwen3-32B": "multilingual",
    "Qwen3-8B": "multilingual",
}

# Models displayed by default (others unchecked until user enables them)
DEFAULT_MODELS = [
    "norolmo-13b",
    "normistral-7b-warm",
    "normistral-11b-warm",
    "normistral-11b-long",
    "olmo-2-13b (stage 1)",
    "OLMo-2-1124-13B",
]

# Hand-picked colors for default models (from the MODEL_COLORS palette in app.js)
MODEL_COLOR_MAP = {
    "norolmo-13b": "#6366f1",          # indigo
    "normistral-7b-warm": "#f43f5e",   # rose
    "normistral-11b-warm": "#10b981",  # emerald
    "normistral-11b-long": "#f59e0b",  # amber
    "olmo-2-13b (stage 1)": "#8b5cf6", # violet
    "OLMo-2-1124-13B": "#06b6d4",      # cyan
}

# Model information: short description + HuggingFace URL
MODEL_INFO = {
    "norolmo-13b": {
        "description": "A fully-open 13B parameter Norwegian language model continually-trained on OLMo2, trained by the Language Technology Group at the University of Oslo.",
        "huggingface_url": "https://huggingface.co/HPLT/NorOLMo-13B",
    },
    "norolmo-13b-stage1": {
        "description": "The final stage-1 checkpoint of NorOLMo-13B (after 24,000 steps). NorOLMo is a fully-open 13B parameter Norwegian language model continually-trained on OLMo2, trained by the Language Technology Group at the University of Oslo.",
        "huggingface_url": "https://huggingface.co/HPLT/NorOLMo-13B",
    },
    "normistral-7b-warm": {
        "description": "A 7B parameter Norwegian language model initialized from Mistral-7B-v0.1 and continually-trained on 260 billion subword tokens of Norwegian data. Trained by the Language Technology Group at the University of Oslo.",
        "huggingface_url": "https://huggingface.co/norallm/normistral-7b-warm",
    },
    "normistral-11b-warm": {
        "description": "An 11.4B parameter Norwegian language model based on Mistral-Nemo-Base-2407, continually-trained on 250 billion tokens of Norwegian, Scandinavian, Sámi and code data. Trained by the Language Technology Group at the University of Oslo.",
        "huggingface_url": "https://huggingface.co/norallm/normistral-11b-warm",
    },
    "normistral-11b-long": {
        "description": "An 11.4B parameter Norwegian language model with extended context length, based on normistral-11b-warm.",
        "huggingface_url": "https://huggingface.co/norallm/normistral-11b-long",
    },
    "norbert4-xlarge": {
        "description": "The fourth generation NorBERT model (987M parameters) for Norwegian encoding/decoding. Trained from scratch on 600B tokens of Norwegian Bokmål, Nynorsk and Northern Sámi. Trained by the Language Technology Group at the University of Oslo.",
        "huggingface_url": "https://huggingface.co/ltg/norbert4-xlarge",
    },
    "olmo-2-13b (stage 1)": {
        "description": "A specific stage 1 checkpoint of OLMo 2 13B, a 13B parameter open language model trained on 5 trillion tokens by the Allen Institute for AI.",
        "huggingface_url": "https://huggingface.co/allenai/OLMo-2-1124-13B",
    },
    "Apertus-8B-2509": {
        "description": "An 8B parameter multilingual model supporting over 1000 languages, designed for fully-open and transparent language modeling. Trained on 15T tokens.",
        "huggingface_url": "https://huggingface.co/swiss-ai/Apertus-8B-2509",
    },
    "NorGPT-3B": {
        "description": "A 3B parameter generative pretrained transformer for Norwegian based on GPT-2 architecture. Part of the NorGLM suite trained on ~25B tokens.",
        "huggingface_url": "https://huggingface.co/NorGLM/NorGPT-3B",
    },
    "NorLlama-3B": {
        "description": "A 3B parameter generative pretrained transformer for Norwegian based on Llama architecture. Part of the NorGLM suite.",
        "huggingface_url": "https://huggingface.co/NorGLM/NorLlama-3B",
    },
    "NorwAI-Mistral-7B": {
        "description": "A 7B parameter model continually-trained on Mistral-7B-v0.1 using 51B tokens of Norwegian and Nordic data. Part of the NorwAI LLM family from NTNU.",
        "huggingface_url": "https://huggingface.co/NorwAI/NorwAI-Mistral-7B",
    },
    "NorwAI-Mixtral-8x7B": {
        "description": "A 45B parameter MoE model continually-trained on Mixtral-8x7B-v0.1 using 51B tokens of Norwegian and Nordic data. Part of the NorwAI LLM family from NTNU.",
        "huggingface_url": "https://huggingface.co/NorwAI/NorwAI-Mixtral-8x7B",
    },
    "nb-gpt-j-6B": {
        "description": "A 6B parameter Norwegian fine-tuned version of GPT-J. Part of the Norwegian National Library's effort to create Norwegian language models.",
        "huggingface_url": "https://huggingface.co/NbAiLab/nb-gpt-j-6B",
    },
    "EuroLLM-22B-2512": {
        "description": "A 22B parameter multilingual transformer trained on 4 trillion tokens across EU languages. Features Grouped Query Attention and 32k token context window.",
        "huggingface_url": "https://huggingface.co/utter-project/EuroLLM-22B-2512",
    },
    "EuroLLM-9B-2512": {
        "description": "A 9B parameter multilingual transformer supporting 34 languages, an enhanced version of EuroLLM-9B with long-context extension.",
        "huggingface_url": "https://huggingface.co/utter-project/EuroLLM-9B-2512",
    },
    "gemma-3-12b-pt": {
        "description": "A 12B parameter multimodal model from Google trained on 12 trillion tokens. Supports 140+ languages with text and image input.",
        "huggingface_url": "https://huggingface.co/google/gemma-3-12b-pt",
    },
    "gemma-3-27b-pt": {
        "description": "A 27B parameter multimodal model from Google trained on 14 trillion tokens. Supports text and image understanding with 128k context window.",
        "huggingface_url": "https://huggingface.co/google/gemma-3-27b-pt",
    },
    "Llama-3.1-8B": {
        "description": "An 8B parameter multilingual language model from Meta supporting 8 languages. Trained on 15T+ tokens with 128k context length.",
        "huggingface_url": "https://huggingface.co/meta-llama/Llama-3.1-8B",
    },
    "Mistral-7B-v0.1": {
        "description": "A 7B parameter generative text model from Mistral AI that uses Grouped-Query Attention and Sliding-Window Attention.",
        "huggingface_url": "https://huggingface.co/mistralai/Mistral-7B-v0.1",
    },
    "Mistral-Nemo-Base-2407": {
        "description": "A 12B parameter pretrained generative text model trained jointly by Mistral AI and NVIDIA. Features 128k context window and multilingual support.",
        "huggingface_url": "https://huggingface.co/mistralai/Mistral-Nemo-Base-2407",
    },
    "OLMo-2-1124-13B": {
        "description": "A 13B parameter open language model from the Allen Institute for AI trained on 5 trillion tokens. Licensed under Apache 2.0.",
        "huggingface_url": "https://huggingface.co/allenai/OLMo-2-1124-13B",
    },
    "Olmo-3-1025-7B": {
        "description": "A 7B parameter open language model from the Allen Institute for AI trained on 5.93 trillion tokens with 65k context length.",
        "huggingface_url": "https://huggingface.co/allenai/Olmo-3-1025-7B",
    },
    "Olmo-3-1125-32B": {
        "description": "A 32B parameter open language model from the Allen Institute for AI trained on 5.50 trillion tokens with 65k context length.",
        "huggingface_url": "https://huggingface.co/allenai/Olmo-3-1125-32B",
    },
    "Qwen3-14B": {
        "description": "A 14.8B parameter language model from Qwen supporting thinking and non-thinking modes. Multilingual with 100+ language support.",
        "huggingface_url": "https://huggingface.co/Qwen/Qwen3-14B",
    },
    "Qwen3-32B": {
        "description": "A 32.8B parameter language model from Qwen with advanced reasoning capabilities. Supports 100+ languages.",
        "huggingface_url": "https://huggingface.co/Qwen/Qwen3-32B",
    },
    "Qwen3-8B": {
        "description": "An 8.2B parameter language model from Qwen supporting seamless switching between thinking and non-thinking modes. Multilingual with 100+ language support.",
        "huggingface_url": "https://huggingface.co/Qwen/Qwen3-8B",
    },
}

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


def extract_benchmark_scores(results_json_path, benchmark_name, subtasks=None):
    """Extract max/mean/median of all non-stderr metrics across prompt variants.

    For benchmarks with subtasks (e.g. noreval_multiblimp), also extracts
    per-subtask metrics as virtual metric names like "acc: Person: 1→2".

    Returns dict {metric_name: {"max": ..., "mean": ..., "median": ..., "min": ...}, ...}
    or None if no metrics found.
    """
    with open(results_json_path) as f:
        data = json.load(f)

    results = data.get("results", {})
    bench_exclusions = EXCLUDED_METRICS | EXCLUDED_METRICS_PER_BENCHMARK.get(
        benchmark_name, set()
    )

    # Collect values per metric across prompt variants
    metric_values = {}  # metric_name -> list of values
    for task_key, task_results in results.items():
        if task_key == benchmark_name or task_key.startswith(f"{benchmark_name}_p"):
            for key, val in task_results.items():
                if not key.endswith(",none"):
                    continue
                if "_stderr,none" in key:
                    continue
                metric_name = key[: -len(",none")]
                if metric_name in bench_exclusions:
                    continue
                if isinstance(val, (int, float)):
                    if metric_name not in metric_values:
                        metric_values[metric_name] = []
                    metric_values[metric_name].append(val)

    # Extract subtask metrics (e.g. MultiBLiMP per-phenomenon scores)
    if subtasks:
        for subtask_code, subtask_info in subtasks.items():
            subtask_key = f"{benchmark_name}_{subtask_code}"
            if subtask_key not in results:
                continue
            task_results = results[subtask_key]
            pretty_name = subtask_info["pretty_name"]
            for key, val in task_results.items():
                if not key.endswith(",none"):
                    continue
                if "_stderr,none" in key:
                    continue
                base_metric = key[: -len(",none")]
                if base_metric in bench_exclusions:
                    continue
                if isinstance(val, (int, float)):
                    # Create a virtual metric name: "acc: Person: 1→2"
                    virtual_name = f"{base_metric}: {pretty_name}"
                    if virtual_name not in metric_values:
                        metric_values[virtual_name] = []
                    metric_values[virtual_name].append(val)

    if not metric_values:
        return None

    out = {}
    for metric_name, values in metric_values.items():
        out[metric_name] = {
            "max": round(max(values), 6),
            "mean": round(statistics.mean(values), 6),
            "median": round(statistics.median(values), 6),
            "min": round(min(values), 6),
        }
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
            agg = extract_benchmark_scores(results_file, benchmark, subtasks)
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
        "model_colors": MODEL_COLOR_MAP,
        "model_info": MODEL_INFO,
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
