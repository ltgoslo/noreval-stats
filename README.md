# NorEval Stats

Evaluation results and interactive visualizations for Norwegian language models, benchmarked with [lm-eval-harness](https://github.com/EleutherAI/lm-evaluation-harness) on the **NorEval** benchmark suite.

**[View the interactive results](https://ltgoslo.github.io/noreval-stats/)**

## Models

25 base models across two categories:

**Norwegian models:** NorOLMo 13B, NorMistral 7B/11B/11B Long, NorBERT4 1B, NorwAI NorGPT 3B, NorwAI NorLlama 8B, NorwAI Mistral 7B, NorwAI Mixtral 8x7B, NB-GPT-J 6B,

**Multilingual baselines:** Apertus 8B, EuroLLM 9B/22B, Gemma3 12B/27B, Llama3.1 8B, Mistral 7B/12B, OLMo2 13B, OLMo2 13B (stage 1), OLMo3 7B/32B, Qwen3 8B/14B/32B

The training progress of NorOLMo is tracked across 33 checkpoints (steps 1,000–33,000).

## Benchmarks

34 benchmarks across 5 categories, evaluated at 0-shot, 1-shot, and 5-shot settings:

| Category | Benchmarks |
|----------|-----------|
| World Knowledge & Reasoning | CommonsenseQA, OpenBookQA (no fact), TruthfulQA (MC & gen), NRK Quiz |
| Language Understanding | BeleBele, OpenBookQA, NoReC (sentence & document), NorQuAD |
| Linguistic Knowledge | NCB, NoCOLA, Idiom Completion, SLIDE, Grammar Correction (ASK-GEC) |
| Generation & Summarization | Summarization, Instruction-following |
| Translation | ENG↔NOB, ENG↔NNO, NOB↔SME, NOB↔NNO |

Many benchmarks include both Bokmål (NOB) and Nynorsk (NNO) variants. The best score across prompt variants (typically 4–6 per benchmark) is reported.

## Interactive Website

The website provides two views:

- **Model Comparison** — Bar charts comparing all models on selected benchmarks
- **Training Progress** — Line charts showing NorOLMo's performance over training steps

Features include normalized aggregate scores, per-task views, category/language filters, 0/1/5-shot toggle, and high-resolution PNG/SVG chart export.

## Adding a New Model

1. Add evaluation results under `results/<model-name>/` (same structure as existing models)
2. Add a display name in `MODEL_DISPLAY_NAMES` in `build_data.py`
3. Run `python3 build_data.py` to regenerate `docs/data.json`
4. Commit and push — GitHub Actions will rebuild automatically

## Building Locally

```bash
pip install pyyaml
python3 build_data.py
python3 -m http.server 8000 -d docs   # Preview at http://localhost:8000
```

## License

[MIT](LICENSE)
