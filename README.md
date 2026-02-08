# NorEval Stats

Evaluation results and interactive visualizations for Norwegian language models, benchmarked with [lm-eval-harness](https://github.com/EleutherAI/lm-evaluation-harness) v0.4.10 on the **NorEval** benchmark suite.

**[View the interactive results](https://ltgoslo.github.io/noreval-stats/)**

## Models

| Model | Parameters | Description |
|-------|-----------|-------------|
| NorOLMo 13B | 13B | Norwegian OLMo, final checkpoint |
| NorMistral 7B | 7B | Mistral warm-started on Norwegian |
| NorMistral 11B | 11B | Mistral warm-started on Norwegian |
| NorMistral 11B Long | 11B | Long-context variant |
| OLMo-2 13B Stage1 | 13B | OLMo-2 Stage 1 baseline |

The training progress of NorOLMo is tracked across 33 checkpoints (steps 1,000–33,000).

## Benchmarks

34 benchmarks across 6 categories, evaluated at 0-shot, 1-shot, and 5-shot settings:

| Category | Benchmarks |
|----------|-----------|
| Knowledge & Reasoning | BeleBele, CommonsenseQA, OpenBookQA, TruthfulQA (MC), NRK Quiz |
| Language Understanding | Comma Benchmark, NoCOLA, NorQuAD |
| Sentiment Analysis | NoReC (sentence), NoReC (document) |
| Generation & Summarization | TruthfulQA (gen), Summarization, Idiom, Grammar Correction, Instruction-following |
| Translation | ENG↔NOB, ENG↔NNO, NOB↔SME, NOB↔NNO |
| Language ID | SLIDE |

Many benchmarks include both Bokmål (NOB) and Nynorsk (NNO) variants. Scores are averaged across prompt variants (typically 4–6 per benchmark) for robustness.

## Repository Structure

```
noreval-stats/
├── results/                 # Cross-model comparison (final checkpoints)
│   ├── NorOLMo-13b/
│   ├── normistral-7b-warm/
│   ├── normistral-11b-warm/
│   ├── normistral-11b-long/
│   └── olmo-2-13B-stage1/
├── NorOLMo_progress/        # NorOLMo training checkpoints (step 1k–33k)
├── docs/                    # GitHub Pages website
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── data.json            # Consolidated data (built from results)
├── metrics_setup.yaml       # Benchmark definitions (metrics, baselines, categories)
├── build_data.py            # Script to build docs/data.json
└── check_missing.py         # Validation script for data completeness
```

Each benchmark directory contains `0-shot/`, `1-shot/`, and `5-shot/` subdirectories with `results_*.json` files holding aggregate metrics.

## Interactive Website

The website provides two views:

- **Model Comparison** — Bar charts comparing all models on selected benchmarks
- **Training Progress** — Line charts showing NorOLMo's performance over training steps

Features:
- Aggregate scores normalized to 0 (random baseline) – 100 (perfect), or view raw scores per task
- Filter by task category or individual benchmark
- Toggle between 0-shot, 1-shot, and 5-shot
- NOB/NNO and translation pairs shown as grouped bars

## Adding a New Model

1. Create a directory under `results/` with the model's evaluation output (same structure as existing models)
2. Run the build script to regenerate the data:
   ```bash
   python3 build_data.py
   ```
3. Optionally add a display name in the `MODEL_DISPLAY_NAMES` dict in `build_data.py`
4. Commit and push — GitHub Actions will rebuild `data.json` automatically

## Building Locally

```bash
# Generate docs/data.json from all results
pip install pyyaml
python3 build_data.py

# Preview the website
python3 -m http.server 8000 -d docs
# Open http://localhost:8000
```

## Validation

Check that all models have complete results:

```bash
pip install pyyaml
python3 check_missing.py
```

## Evaluation Details

- **Hardware**: NVIDIA GH200 120GB GPUs
- **Framework**: vLLM for model serving
- **Seeds**: Fixed (random=0, numpy=1234, torch=1234, fewshot=1234)
- **Prompt variants**: Each benchmark uses multiple prompt phrasings; scores are max-aggregated across variants

## License

[MIT](LICENSE)
