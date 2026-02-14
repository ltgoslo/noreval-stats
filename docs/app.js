// NorEval Benchmark Visualization
// ================================

let DATA = null;
let currentTab = "comparison";
let currentShot = "5";
let currentTaskSelection = "__all_macro__";
let currentPromptAgg = "max";
let currentNormalization = "baseline"; // auto-set based on view
let currentMetric = null; // null = use main_metric; set for individual task views
let checkedTasks = new Set();
let checkedModels = new Set();
let showStderr = true;
let showPromptDeviation = true;

const MODEL_COLORS = [
  "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#14b8a6", "#f97316",
  "#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#0ea5e9",
];

const METRIC_DISPLAY = {
  acc: "accuracy",
  acc_norm: "accuracy (normalized)",
  f1: "F1",
  em: "exact match",
  em_first: "exact match (first word)",
  exact_match: "exact match",
  fscore: "F-score",
  bleu: "BLEU",
  bleu_max: "BLEU (best ref.)",
  bleu_avg: "BLEU (avg ref.)",
  bleu_acc: "BLEU accuracy",
  chrf: "chrF",
  rougeL_max: "ROUGE-L (best ref.)",
  rougeL_avg: "ROUGE-L (avg ref.)",
  rougeL_acc: "ROUGE-L accuracy",
  rouge1_max: "ROUGE-1 (best ref.)",
  rouge1_acc: "ROUGE-1 accuracy",
  rouge2_max: "ROUGE-2 (best ref.)",
  rouge2_acc: "ROUGE-2 accuracy",
  errant_f05: "ERRANT F0.5",
};

const METRIC_SCALES = {
  acc: "unit", acc_norm: "unit", f1: "unit", em: "unit", em_first: "unit", exact_match: "unit",
  errant_f05: "unit", fscore: "unit",
  bleu: "percent", bleu_max: "percent", bleu_avg: "percent",
  bleu_acc: "unit",
  chrf: "percent",
  rougeL_max: "percent", rougeL_avg: "percent",
  rougeL_acc: "unit",
  rouge1_max: "percent", rouge1_acc: "unit",
  rouge2_max: "percent", rouge2_acc: "unit",
};

const METRIC_DESCRIPTIONS = {
  acc: "Proportion of correctly classified examples.",
  acc_norm: "Accuracy after normalizing for answer option length.",
  f1: "Harmonic mean of precision and recall.",
  em: "Proportion of predictions that exactly match the reference.",
  em_first: "Exact match accuracy of the first generated word against the correct completion word.",
  exact_match: "Proportion of predictions that exactly match the reference.",
  fscore: "Token-level overlap between predicted and reference text.",
  bleu: "Measures n-gram overlap between generated and reference text.",
  bleu_max: "Highest BLEU score across multiple reference texts.",
  bleu_avg: "Average BLEU score across multiple reference texts.",
  bleu_acc: "Fraction of examples where the generation is more similar (by BLEU) to correct answers than incorrect ones.",
  chrf: "Character-level F-score between generated and reference text.",
  rougeL_max: "Longest common subsequence overlap with the best-matching reference.",
  rougeL_avg: "Average longest common subsequence overlap across references.",
  rougeL_acc: "Fraction of examples where the generation is more similar (by ROUGE-L) to correct answers than incorrect ones.",
  rouge1_max: "Unigram overlap with the best-matching reference.",
  rouge1_acc: "Fraction of examples where the generation is more similar (by ROUGE-1) to correct answers than incorrect ones.",
  rouge2_max: "Bigram overlap with the best-matching reference.",
  rouge2_acc: "Fraction of examples where the generation is more similar (by ROUGE-2) to correct answers than incorrect ones.",
  errant_f05: "Grammar error correction metric emphasizing precision (F0.5) over recall.",
};

const PROGRESS_PAIR_COLORS = ["#3b82f6", "#ef4444"]; // blue, red

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtons: [
    [
      {
        name: "Download plot as PNG",
        icon: Plotly.Icons.camera,
        click: function (gd) {
          Plotly.downloadImage(gd, {
            format: "png",
            width: 1600,
            height: 900,
            scale: 3,
            filename: "noreval-chart",
          });
        },
      },
      {
        name: "Download plot as SVG",
        icon: Plotly.Icons.camera,
        click: function (gd) {
          Plotly.downloadImage(gd, {
            format: "svg",
            width: 1600,
            height: 900,
            filename: "noreval-chart",
          });
        },
      },
    ],
  ],
};

// ============================================================
// Color utilities
// ============================================================

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

function lightenColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function darkenColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function hexToRgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

function getModelColor(modelDir) {
  if (DATA.model_colors && DATA.model_colors[modelDir]) {
    return DATA.model_colors[modelDir];
  }
  const assignedColors = new Set(Object.values(DATA.model_colors || {}));
  const availableColors = MODEL_COLORS.filter((c) => !assignedColors.has(c));
  const unassignedModels = Object.keys(DATA.models).filter((m) => !(DATA.model_colors && DATA.model_colors[m]));
  const idx = unassignedModels.indexOf(modelDir);
  return availableColors[idx % availableColors.length];
}

// ============================================================
// Score access (prompt aggregation aware)
// ============================================================

/** Get raw score from data source, respecting prompt aggregation mode.
 *  metric defaults to the benchmark's main_metric if not provided. */
function getScore(dataSource, entity, bench, shot, metric) {
  metric = metric || DATA.metrics_setup[bench]?.main_metric;
  const obj = dataSource[entity]?.[bench]?.[shot]?.[metric];
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj === "number") return obj; // backward compat
  return obj[currentPromptAgg];
}

/** Get raw stderr from data source, respecting prompt aggregation mode. */
function getStderr(dataSource, entity, bench, shot, metric) {
  metric = metric || DATA.metrics_setup[bench]?.main_metric;
  const obj = dataSource[entity]?.[bench]?.[shot]?.[metric];
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj === "number") return undefined; // old format, no stderr
  const key = currentPromptAgg + "_stderr";
  const se = obj[key];
  return (se !== undefined && se !== null) ? se : undefined;
}

/** Get prompt-variant SE: SD(prompt_scores) / sqrt(n_prompts). */
function getPromptSE(dataSource, entity, bench, shot, metric) {
  metric = metric || DATA.metrics_setup[bench]?.main_metric;
  const obj = dataSource[entity]?.[bench]?.[shot]?.[metric];
  if (!obj || typeof obj === "number") return undefined;
  const sd = obj.prompt_sd;
  const n = obj.n_prompts;
  if (sd == null || n == null || n < 2) return undefined;
  return sd / Math.sqrt(n);
}

/** Get combined SE from sampling stderr and/or prompt deviation, respecting toggles. */
function getCombinedSE(dataSource, entity, bench, shot, metric) {
  const sampSe = showStderr ? getStderr(dataSource, entity, bench, shot, metric) : undefined;
  const promptSe = showPromptDeviation ? getPromptSE(dataSource, entity, bench, shot, metric) : undefined;
  if (sampSe == null && promptSe == null) return undefined;
  return Math.sqrt((sampSe || 0) ** 2 + (promptSe || 0) ** 2);
}

/** Scale a raw stderr value for display, applying the same transform as the score.
 *  Only works for "none" and "baseline" normalization. */
function scaleStderr(se, benchmark, metric) {
  if (se === undefined || se === null) return undefined;
  if (currentNormalization === "none") return toDisplayScale(se, benchmark, metric);
  if (currentNormalization === "baseline") {
    const info = DATA.metrics_setup[benchmark];
    const range = info.max_performance - info.random_baseline;
    return range === 0 ? 0 : (se / range) * 100;
  }
  return undefined; // not supported for other normalizations
}

/** Check if stderr display is compatible with the current normalization mode. */
function isStderrCompatible() {
  return currentNormalization === "none" || currentNormalization === "baseline";
}

/** Extract the base metric name from a subtask metric like "acc: Person: 1→2" → "acc" */
function getBaseMetric(metric) {
  if (!metric) return metric;
  const sep = metric.indexOf(": ");
  return sep !== -1 && METRIC_SCALES[metric.slice(0, sep)] ? metric.slice(0, sep) : metric;
}

/** Convert raw stored score to 0-100 display scale */
function toDisplayScale(value, benchmark, metric) {
  const base = metric ? getBaseMetric(metric) : null;
  const scale = base ? (METRIC_SCALES[base] || "unit") : DATA.metrics_setup[benchmark].metric_scale;
  return scale === "unit" ? value * 100 : value;
}

// ============================================================
// Normalization
// ============================================================

/** Baseline normalization: 0 = random, 100 = perfect */
function baselineNorm(raw, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  const base = info.random_baseline, max = info.max_performance;
  return max === base ? 0 : ((raw - base) / (max - base)) * 100;
}

/** Apply current normalization to a raw score.
 *  For min-max, z-score, and percentile, pass allRaw = array of all raw scores for this benchmark.
 *  Optional metric parameter for correct display scale of non-main metrics. */
function applyNorm(raw, benchmark, allRaw, metric) {
  if (currentNormalization === "none") return toDisplayScale(raw, benchmark, metric);
  if (currentNormalization === "baseline") return baselineNorm(raw, benchmark);
  if (currentNormalization === "minmax") {
    if (!allRaw || allRaw.length < 2) return toDisplayScale(raw, benchmark, metric);
    const mn = Math.min(...allRaw), mx = Math.max(...allRaw);
    return mx === mn ? 50 : ((raw - mn) / (mx - mn)) * 100;
  }
  if (currentNormalization === "zscore") {
    if (!allRaw || allRaw.length < 2) return 0;
    const mean = allRaw.reduce((a, b) => a + b, 0) / allRaw.length;
    const std = Math.sqrt(allRaw.reduce((s, v) => s + (v - mean) ** 2, 0) / allRaw.length);
    return std === 0 ? 0 : (raw - mean) / std;
  }
  if (currentNormalization === "percentile") {
    if (!allRaw || allRaw.length < 2) return 50;
    const below = allRaw.filter((v) => v < raw).length;
    const equal = allRaw.filter((v) => v === raw).length;
    return ((below + (equal - 1) / 2) / (allRaw.length - 1)) * 100;
  }
  return toDisplayScale(raw, benchmark, metric);
}

function getNormYLabel() {
  if (currentNormalization === "baseline") return "normalized score (baseline=0, perfect=100)";
  if (currentNormalization === "minmax") return "normalized score (min-max across models)";
  if (currentNormalization === "zscore") return "z-score (standard deviations from mean)";
  if (currentNormalization === "percentile") return "percentile rank (0=worst, 100=best)";
  return "score (0\u2013100)";
}

function getMetricYLabel(benchmark, metric) {
  const m = metric || DATA.metrics_setup[benchmark].main_metric;
  if (METRIC_DISPLAY[m]) return METRIC_DISPLAY[m];
  const base = getBaseMetric(m);
  if (base !== m && METRIC_DISPLAY[base]) return METRIC_DISPLAY[base];
  return m;
}

function autoSetNormalization() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) {
    currentNormalization = "baseline";
  } else {
    currentNormalization = "none";
  }
  document.getElementById("norm-select").value = currentNormalization;
  updateStderrToggleState();
}

function updateStderrToggleState() {
  const control = document.getElementById("stderr-control");
  const toggle = document.getElementById("stderr-toggle");
  const pdControl = document.getElementById("prompt-dev-control");
  const pdToggle = document.getElementById("prompt-dev-toggle");
  if (!control || !toggle) return;
  if (isStderrCompatible()) {
    control.classList.remove("disabled");
    if (pdControl) pdControl.classList.remove("disabled");
  } else {
    control.classList.add("disabled");
    toggle.checked = false;
    showStderr = false;
    if (pdControl) {
      pdControl.classList.add("disabled");
      if (pdToggle) { pdToggle.checked = false; showPromptDeviation = false; }
    }
  }
}

// ============================================================
// Metric selector
// ============================================================

/** Get the effective metric for the current individual/group view */
function getEffectiveMetric(benchmark) {
  return currentMetric || DATA.metrics_setup[benchmark]?.main_metric;
}

/** Populate the metric selector for the given benchmark(s) and show it.
 *  For groups, takes the intersection of available metrics. */
function populateMetricSelector(benchmarks) {
  const select = document.getElementById("metric-select");
  const control = document.getElementById("metric-control");
  if (!select || !control) return;

  // Get available metrics (intersection for groups)
  let metrics = null;
  for (const bench of benchmarks) {
    const info = DATA.metrics_setup[bench];
    if (!info || !info.available_metrics) continue;
    const set = new Set(info.available_metrics);
    metrics = metrics ? new Set([...metrics].filter((m) => set.has(m))) : set;
  }
  if (!metrics || metrics.size <= 1) {
    hideMetricSelector();
    return;
  }

  const mainMetric = DATA.metrics_setup[benchmarks[0]]?.main_metric;
  const info = DATA.metrics_setup[benchmarks[0]];
  const hasSubtasks = info && info.subtasks;

  // Separate base metrics from subtask metrics (contain ": ")
  const baseMetrics = [];
  const subtaskMetrics = [];
  for (const m of metrics) {
    if (m.indexOf(": ") !== -1 && METRIC_SCALES[m.slice(0, m.indexOf(": "))]) {
      subtaskMetrics.push(m);
    } else {
      baseMetrics.push(m);
    }
  }

  // Order base metrics: main_metric first, then sorted
  const orderedBase = [];
  if (mainMetric && baseMetrics.includes(mainMetric)) orderedBase.push(mainMetric);
  for (const m of baseMetrics.sort()) {
    if (m !== mainMetric) orderedBase.push(m);
  }

  select.innerHTML = "";

  // Add base metrics (no optgroup needed if no subtask metrics)
  for (const m of orderedBase) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = METRIC_DISPLAY[m] || m;
    if (m === mainMetric) opt.textContent += " (default)";
    select.appendChild(opt);
  }

  // Group subtask metrics by category (e.g. "Person" vs "Number") and base metric
  if (subtaskMetrics.length > 0 && hasSubtasks) {
    // Group by base metric (acc, acc_norm, etc.)
    const byBaseMetric = {};
    for (const m of subtaskMetrics) {
      const base = getBaseMetric(m);
      if (!byBaseMetric[base]) byBaseMetric[base] = [];
      byBaseMetric[base].push(m);
    }

    for (const base of Object.keys(byBaseMetric).sort()) {
      const items = byBaseMetric[base].sort();
      // Sub-group by phenomenon category (Person / Number / etc.)
      const byCategory = {};
      for (const m of items) {
        // m is like "acc: Person: 1→2" or "acc: Number: SG→PL"
        const afterBase = m.slice(base.length + 2); // "Person: 1→2"
        const catSep = afterBase.indexOf(": ");
        const cat = catSep !== -1 ? afterBase.slice(0, catSep) : "Subtasks";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(m);
      }

      for (const cat of Object.keys(byCategory).sort()) {
        const group = document.createElement("optgroup");
        const baseLabel = METRIC_DISPLAY[base] || base;
        group.label = baseLabel + " \u2014 " + cat;
        for (const m of byCategory[cat]) {
          const opt = document.createElement("option");
          opt.value = m;
          // Display just the specific part, e.g. "1→2" or "SG→PL"
          const afterBase = m.slice(base.length + 2);
          const catSep = afterBase.indexOf(": ");
          opt.textContent = catSep !== -1 ? afterBase.slice(catSep + 2) : afterBase;
          group.appendChild(opt);
        }
        select.appendChild(group);
      }
    }
  }

  // Preserve current metric if still available, otherwise reset to main
  if (currentMetric && metrics.has(currentMetric)) {
    select.value = currentMetric;
  } else {
    currentMetric = mainMetric;
    select.value = mainMetric;
  }
  control.style.display = "";
}

function hideMetricSelector() {
  const control = document.getElementById("metric-control");
  if (control) control.style.display = "none";
  currentMetric = null;
}

// ============================================================
// URL state (shareable links)
// ============================================================

// Alias lookup maps (built on init from data)
let _modelDirToAlias = {};
let _modelAliasToDir = {};
let _taskSelToAlias = {};
let _taskAliasToSel = {};

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildUrlMaps() {
  // Model aliases: slugified display name → dir name
  for (const dir of Object.keys(DATA.models)) {
    const alias = slugify(getModelLabel(dir));
    _modelDirToAlias[dir] = alias;
    _modelAliasToDir[alias] = dir;
  }

  // Aliases for aggregate selection types
  _taskSelToAlias["__all__"] = "all-micro";
  _taskAliasToSel["all-micro"] = "__all__";
  _taskSelToAlias["__custom__"] = "custom";
  _taskAliasToSel["custom"] = "__custom__";

  // Task selection aliases for categories, languages, eval types, groups
  const cats = new Set();
  const evals = new Set();
  for (const info of Object.values(DATA.metrics_setup)) {
    cats.add(info.category);
    if (info.evaluation_type) evals.add(info.evaluation_type);
  }
  for (const cat of cats) {
    const sel = "__cat__" + cat, alias = "c:" + slugify(cat);
    _taskSelToAlias[sel] = alias;
    _taskAliasToSel[alias] = sel;
  }
  for (const et of evals) {
    const sel = "__eval__" + et, alias = "e:" + slugify(et);
    _taskSelToAlias[sel] = alias;
    _taskAliasToSel[alias] = sel;
  }
  for (const lang of ["nob", "nno", "sme"]) {
    const sel = "__lang__" + lang, alias = "l:" + lang;
    _taskSelToAlias[sel] = alias;
    _taskAliasToSel[alias] = sel;
  }
  for (const gn of Object.keys(DATA.task_groups)) {
    const sel = "__group__" + gn, alias = "g:" + slugify(gn);
    _taskSelToAlias[sel] = alias;
    _taskAliasToSel[alias] = sel;
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function stateToUrl() {
  if (!DATA) return;
  const params = new URLSearchParams();

  if (currentTab !== "comparison") params.set("tab", currentTab);
  if (currentShot !== "5") params.set("shot", currentShot);
  if (currentTaskSelection !== "__all_macro__") {
    params.set("task", _taskSelToAlias[currentTaskSelection] || currentTaskSelection);
  }
  if (currentPromptAgg !== "max") params.set("prompt", currentPromptAgg);
  if (!showStderr) params.set("se", "0");
  if (!showPromptDeviation) params.set("pd", "0");

  // Only store metric if it differs from main_metric for the current task
  if (currentMetric && !isAggregateSelection(currentTaskSelection)) {
    const benchmarks = getBenchmarksForSelection(currentTaskSelection);
    const mainMetric = benchmarks.length > 0 ? DATA.metrics_setup[benchmarks[0]]?.main_metric : null;
    if (currentMetric !== mainMetric) params.set("metric", currentMetric);
  }

  // Only store normalization if it differs from what auto-set would give
  const autoNorm = isAggregateSelection(currentTaskSelection) ? "baseline" : "none";
  if (currentNormalization !== autoNorm) params.set("norm", currentNormalization);

  // Models: "all" for all, omit for defaults, aliases otherwise
  const allModelSet = new Set(Object.keys(DATA.models));
  const defaultModelSet = new Set((DATA.default_models || []).filter((m) => m in DATA.models));
  if (!setsEqual(checkedModels, defaultModelSet)) {
    if (setsEqual(checkedModels, allModelSet)) {
      params.set("models", "all");
    } else {
      params.set("models", [...checkedModels].map((d) => _modelDirToAlias[d] || d).sort().join(","));
    }
  }

  // Tasks: only store if different from what the current task selection auto-selects
  const autoTasks = new Set(getBenchmarksForSelection(currentTaskSelection));
  if (!setsEqual(checkedTasks, autoTasks)) {
    params.set("tasks", [...checkedTasks].sort().join(","));
  }

  const hash = params.toString();
  const newHash = hash ? "#" + hash : "";
  if (window.location.hash !== newHash) {
    history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
  }
}

function loadStateFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  let loaded = false;

  if (params.has("tab")) { currentTab = params.get("tab"); loaded = true; }
  if (params.has("shot")) { currentShot = params.get("shot"); loaded = true; }
  if (params.has("task")) {
    const alias = params.get("task");
    currentTaskSelection = _taskAliasToSel[alias] || alias;
    loaded = true;
  }
  if (params.has("prompt")) { currentPromptAgg = params.get("prompt"); loaded = true; }
  if (params.has("metric")) { currentMetric = params.get("metric"); loaded = true; }
  if (params.has("norm")) { currentNormalization = params.get("norm"); loaded = true; }
  if (params.has("se")) { showStderr = params.get("se") !== "0"; loaded = true; }
  if (params.has("pd")) { showPromptDeviation = params.get("pd") !== "0"; loaded = true; }

  if (params.has("models")) {
    const val = params.get("models");
    if (val === "all") {
      checkedModels = new Set(Object.keys(DATA.models));
    } else {
      checkedModels = val
        ? new Set(val.split(",").map((a) => _modelAliasToDir[a] || a).filter((m) => m in DATA.models))
        : new Set();
    }
    loaded = true;
  }

  if (params.has("tasks")) {
    const val = params.get("tasks");
    checkedTasks = val ? new Set(val.split(",").filter((t) => t in DATA.metrics_setup)) : new Set();
    loaded = true;
  } else if (loaded && params.has("task")) {
    // Task selection changed but no explicit tasks override; auto-select
    checkedTasks = new Set(getBenchmarksForSelection(currentTaskSelection));
  }

  // If normalization not explicitly set, auto-determine from task selection
  if (!params.has("norm") && loaded) {
    currentNormalization = isAggregateSelection(currentTaskSelection) ? "baseline" : "none";
  }

  return loaded;
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();

  // Set defaults
  const defaultModels = DATA.default_models || Object.keys(DATA.models);
  checkedModels = new Set(defaultModels.filter((m) => m in DATA.models));
  checkedTasks = new Set(Object.keys(DATA.metrics_setup));

  // Build URL alias maps, then restore state from URL hash
  buildUrlMaps();
  const hasUrlState = loadStateFromHash();

  // Build UI
  populateTaskDropdown();
  bindEventListeners();
  buildCheckboxes();
  buildModelCheckboxes();

  if (hasUrlState) {
    // Sync UI controls to restored state
    document.getElementById("task-select").value = currentTaskSelection;
    document.getElementById("prompt-agg-select").value = currentPromptAgg;
    document.getElementById("norm-select").value = currentNormalization;
    document.getElementById("stderr-toggle").checked = showStderr;
    document.getElementById("prompt-dev-toggle").checked = showPromptDeviation;
    document.querySelectorAll(".tab-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === currentTab));
    document.querySelectorAll(".shot-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.shot === currentShot));
    syncCheckboxStates();
    syncModelCheckboxStates();
    updateStderrToggleState();
  } else {
    autoSetNormalization();
  }

  renderChart();
}

// ============================================================
// Dropdown
// ============================================================

function populateTaskDropdown() {
  const select = document.getElementById("task-select");

  const categories = {};
  for (const [bench, info] of Object.entries(DATA.metrics_setup)) {
    const cat = info.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(bench);
  }

  const catGroup = document.createElement("optgroup");
  catGroup.label = "Aggregate by Category";
  for (const catName of Object.keys(categories).sort()) {
    const opt = document.createElement("option");
    opt.value = "__cat__" + catName;
    opt.textContent = catName;
    catGroup.appendChild(opt);
  }
  select.appendChild(catGroup);

  const evalTypes = {};
  for (const [bench, info] of Object.entries(DATA.metrics_setup)) {
    const et = info.evaluation_type;
    if (et) { if (!evalTypes[et]) evalTypes[et] = []; evalTypes[et].push(bench); }
  }
  if (Object.keys(evalTypes).length > 0) {
    const evalGroup = document.createElement("optgroup");
    evalGroup.label = "Aggregate by Evaluation Type";
    for (const etName of Object.keys(evalTypes).sort()) {
      const opt = document.createElement("option");
      opt.value = "__eval__" + etName;
      opt.textContent = etName;
      evalGroup.appendChild(opt);
    }
    select.appendChild(evalGroup);
  }

  const langGroup = document.createElement("optgroup");
  langGroup.label = "Aggregate by Language";
  for (const [val, label] of [["__lang__nob","Bokm\u00e5l"],["__lang__nno","Nynorsk"],["__lang__sme","Northern S\u00e1mi"]]) {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    langGroup.appendChild(opt);
  }
  select.appendChild(langGroup);

  const taskGroup = document.createElement("optgroup");
  taskGroup.label = "Individual Tasks";
  const entries = [];
  for (const groupName of Object.keys(DATA.task_groups))
    entries.push({ value: "__group__" + groupName, label: groupName });
  for (const bench of DATA.standalone_benchmarks) {
    const info = DATA.metrics_setup[bench];
    if (info) entries.push({ value: bench, label: info.pretty_name });
  }
  entries.sort((a, b) => a.label.localeCompare(b.label));
  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.value; opt.textContent = entry.label;
    taskGroup.appendChild(opt);
  }
  select.appendChild(taskGroup);
}

// ============================================================
// Event listeners
// ============================================================

function bindEventListeners() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(".tab-btn.active").classList.remove("active");
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      renderChart();
    });
  });

  document.querySelectorAll(".shot-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(".shot-btn.active").classList.remove("active");
      btn.classList.add("active");
      currentShot = btn.dataset.shot;
      renderChart();
    });
  });

  document.getElementById("prompt-agg-select").addEventListener("change", (e) => {
    currentPromptAgg = e.target.value;
    renderChart();
  });

  document.getElementById("norm-select").addEventListener("change", (e) => {
    currentNormalization = e.target.value;
    updateStderrToggleState();
    renderChart();
  });

  document.getElementById("stderr-toggle").addEventListener("change", (e) => {
    showStderr = e.target.checked;
    renderChart();
  });

  document.getElementById("prompt-dev-toggle").addEventListener("change", (e) => {
    showPromptDeviation = e.target.checked;
    renderChart();
  });

  attachTooltip(document.getElementById("stderr-control"), () => ({
    title: "Standard errors",
    body: "Shows sampling uncertainty (\u00B11 SE) around each score. "
      + "For classification metrics (accuracy, F1, EM), SE = \u221A(v\u00B7(1\u2212v)/n). "
      + "For corpus-level metrics (BLEU, chrF, ROUGE), SE is estimated via bootstrap resampling (100 iterations). "
      + "Aggregate SE is propagated as \u221A(\u03A3 SE\u00B2) / N.",
    footer: "",
  }));

  attachTooltip(document.getElementById("prompt-dev-control"), () => ({
    title: "Prompt deviation",
    body: "Shows uncertainty due to prompt formulation. "
      + "Computed as SD(scores across prompt variants) / \u221A(n), where n is the number of prompt variants. "
      + "When combined with standard errors, the two sources are added in quadrature: \u221A(SE\u00B2 + prompt_SE\u00B2). "
      + "Has no effect on single-prompt benchmarks.",
    footer: "",
  }));

  document.getElementById("metric-select").addEventListener("change", (e) => {
    currentMetric = e.target.value;
    renderChart();
  });

  document.getElementById("task-select").addEventListener("change", (e) => {
    currentTaskSelection = e.target.value;
    const benchmarks = getBenchmarksForSelection(currentTaskSelection);
    if (benchmarks.length > 0) checkedTasks = new Set(benchmarks);
    syncCheckboxStates();
    autoSetNormalization();
    renderChart();
  });

  document.getElementById("select-all-btn").addEventListener("click", () => {
    checkedTasks = new Set(Object.keys(DATA.metrics_setup));
    currentTaskSelection = "__all__";
    document.getElementById("task-select").value = "__all__";
    syncCheckboxStates();
    autoSetNormalization();
    renderChart();
  });
  document.getElementById("select-none-btn").addEventListener("click", () => {
    checkedTasks.clear();
    syncCheckboxStates();
    renderChart();
  });

  document.getElementById("model-select-all-btn").addEventListener("click", () => {
    checkedModels = new Set(Object.keys(DATA.models));
    syncModelCheckboxStates();
    renderChart();
  });
  document.getElementById("model-select-none-btn").addEventListener("click", () => {
    checkedModels.clear();
    syncModelCheckboxStates();
    renderChart();
  });
}

// ============================================================
// Selection helpers
// ============================================================

function isAggregateSelection(sel) {
  return sel === "__all__" || sel === "__all_macro__" || sel === "__custom__" || sel.startsWith("__cat__") || sel.startsWith("__lang__") || sel.startsWith("__eval__");
}

function getBenchmarksForSelection(sel) {
  if (sel === "__all__" || sel === "__all_macro__") return Object.keys(DATA.metrics_setup);
  if (sel === "__custom__") return [];
  if (sel.startsWith("__cat__")) {
    const c = sel.slice(7);
    return Object.keys(DATA.metrics_setup).filter((b) => DATA.metrics_setup[b].category === c);
  }
  if (sel.startsWith("__eval__")) {
    const e = sel.slice(8);
    return Object.keys(DATA.metrics_setup).filter((b) => DATA.metrics_setup[b].evaluation_type === e);
  }
  if (sel === "__lang__nno") {
    const nno = new Set(DATA.nno_benchmarks || []);
    for (const b of (DATA.nob_nno_translation_benchmarks || [])) nno.add(b);
    for (const b of (DATA.shared_language_benchmarks || [])) nno.add(b);
    return [...nno];
  }
  if (sel === "__lang__nob") {
    const nnoOnly = new Set(DATA.nno_benchmarks || []);
    const smeOnly = new Set(DATA.sme_benchmarks || []);
    const nobNno = new Set(DATA.nob_nno_translation_benchmarks || []);
    const shared = new Set(DATA.shared_language_benchmarks || []);
    return Object.keys(DATA.metrics_setup).filter((b) => (!nnoOnly.has(b) && !smeOnly.has(b)) || nobNno.has(b) || shared.has(b));
  }
  if (sel === "__lang__sme") return DATA.sme_benchmarks || [];
  if (sel.startsWith("__group__")) {
    const g = DATA.task_groups[sel.slice(9)];
    return g ? g.benchmarks : [];
  }
  if (DATA.metrics_setup[sel]) return [sel];
  return [];
}

function isMacroSelection() {
  return currentTaskSelection === "__all_macro__";
}

/** Group benchmarks by high-level category for macro-averaging.
 *  Returns array of arrays: each inner array is all benchmarks in one category. */
function getMacroGroups(benchmarks) {
  const benchSet = benchmarks instanceof Set ? benchmarks : new Set(benchmarks);
  const categoryGroups = {};
  for (const bench of benchSet) {
    const info = DATA.metrics_setup[bench];
    if (!info) continue;
    const cat = info.category;
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(bench);
  }
  return Object.values(categoryGroups);
}

/** Compute aggregate score over benchmarks using a scoring function.
 *  macro=true: average within task groups first, then across groups.
 *  macro=false: simple micro-average across all benchmarks.
 *  scoreFn(bench) should return { score, stderr } or undefined.
 *    (For backward compat, a plain number is treated as { score: number }.)
 *  Returns { score, count, stderr } or null. */
function aggregateScores(benchmarks, scoreFn, macro) {
  if (macro) {
    const groups = getMacroGroups(benchmarks);
    let groupSum = 0, groupCount = 0, groupSe2 = 0;
    for (const group of groups) {
      let sum = 0, count = 0, se2 = 0;
      for (const bench of group) {
        const r = scoreFn(bench);
        if (r === undefined) continue;
        const s = (typeof r === "number") ? r : r.score;
        if (s === undefined) continue;
        sum += s; count++;
        const se = (typeof r === "object" && r.stderr != null) ? r.stderr : 0;
        se2 += se * se;
      }
      if (count > 0) {
        groupSum += sum / count;
        groupSe2 += se2 / (count * count);
        groupCount++;
      }
    }
    if (groupCount === 0) return null;
    return {
      score: groupSum / groupCount,
      count: groupCount,
      stderr: Math.sqrt(groupSe2) / groupCount,
    };
  } else {
    let sum = 0, count = 0, se2 = 0;
    for (const bench of benchmarks) {
      const r = scoreFn(bench);
      if (r === undefined) continue;
      const s = (typeof r === "number") ? r : r.score;
      if (s === undefined) continue;
      sum += s; count++;
      const se = (typeof r === "object" && r.stderr != null) ? r.stderr : 0;
      se2 += se * se;
    }
    if (count === 0) return null;
    return {
      score: sum / count,
      count,
      stderr: Math.sqrt(se2) / count,
    };
  }
}

/** Find the dropdown value for a single benchmark (group or standalone) */
function findDropdownValueForBench(bench) {
  for (const [gn, g] of Object.entries(DATA.task_groups)) {
    if (g.benchmarks.includes(bench)) return "__group__" + gn;
  }
  if (DATA.standalone_benchmarks.includes(bench)) return bench;
  return null;
}

// ============================================================
// Task checkboxes
// ============================================================

function getCheckboxDisplayName(bench) {
  const info = DATA.metrics_setup[bench];
  let name = info.pretty_name;
  // Only add language tag if the pretty_name doesn't already disambiguate
  const hasDirection = /[\u2192\u2194]/.test(name) || /Bokm\u00e5l|Nynorsk|English|S\u00e1mi/.test(name);
  if (!hasDirection) {
    if (bench.endsWith("_nno")) name += " [Nynorsk]";
    else if (bench.endsWith("_nob")) name += " [Bokm\u00e5l]";
  }
  return name;
}

function buildCheckboxes() {
  const grid = document.getElementById("checkbox-grid");
  grid.innerHTML = "";

  const grouped = {};
  for (const [bench, info] of Object.entries(DATA.metrics_setup)) {
    const cat = info.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(bench);
  }

  for (const cat of Object.keys(grouped).sort()) {
    const catDiv = document.createElement("div");
    catDiv.className = "checkbox-category";
    const h4 = document.createElement("h4");
    h4.textContent = cat;
    h4.style.cursor = "pointer";
    const catBenches = grouped[cat];
    h4.addEventListener("click", () => {
      const allChecked = catBenches.every((b) => checkedTasks.has(b));
      for (const b of catBenches) {
        if (allChecked) checkedTasks.delete(b); else checkedTasks.add(b);
      }
      syncCheckboxStates();
      onTaskCheckboxChange();
    });
    catDiv.appendChild(h4);

    for (const bench of catBenches) {
      const label = document.createElement("label");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checkedTasks.has(bench);
      checkbox.dataset.bench = bench;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) checkedTasks.add(bench);
        else checkedTasks.delete(bench);
        onTaskCheckboxChange();
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + getCheckboxDisplayName(bench)));
      attachTaskTooltip(label, bench);
      catDiv.appendChild(label);
    }
    grid.appendChild(catDiv);
  }
}

function onTaskCheckboxChange() {
  // If exactly 1 task checked, show as single benchmark
  if (checkedTasks.size === 1) {
    const bench = [...checkedTasks][0];
    currentTaskSelection = bench;
    // Update dropdown to closest matching entry
    const ddVal = findDropdownValueForBench(bench);
    if (ddVal) document.getElementById("task-select").value = ddVal;
    autoSetNormalization();
    renderChart();
    return;
  }
  // If exactly 2 tasks that form a group, switch to paired group view
  if (checkedTasks.size === 2) {
    const arr = [...checkedTasks];
    for (const [gn, g] of Object.entries(DATA.task_groups)) {
      if (g.benchmarks.length === 2 && g.benchmarks.includes(arr[0]) && g.benchmarks.includes(arr[1])) {
        currentTaskSelection = "__group__" + gn;
        document.getElementById("task-select").value = currentTaskSelection;
        autoSetNormalization();
        renderChart();
        return;
      }
    }
  }
  // Otherwise, micro-average over custom selection
  currentTaskSelection = "__custom__";
  document.getElementById("task-select").value = "__custom__";
  autoSetNormalization();
  renderChart();
}

function syncCheckboxStates() {
  document.querySelectorAll("#checkbox-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = checkedTasks.has(cb.dataset.bench);
  });
}

// ============================================================
// Model checkboxes
// ============================================================

function buildModelCheckboxes() {
  const grid = document.getElementById("model-checkbox-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const categories = DATA.model_categories || {};
  const groups = { norwegian: [], multilingual: [] };
  for (const modelDir of Object.keys(DATA.models)) {
    const cat = categories[modelDir] || "multilingual";
    groups[cat].push(modelDir);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => getModelLabel(a).localeCompare(getModelLabel(b)));
  }

  const groupLabels = { norwegian: "Norwegian", multilingual: "Multilingual" };
  for (const groupKey of ["norwegian", "multilingual"]) {
    if (groups[groupKey].length === 0) continue;
    const catDiv = document.createElement("div");
    catDiv.className = "model-category-group";
    const h4 = document.createElement("h4");
    h4.textContent = groupLabels[groupKey];
    h4.style.cursor = "pointer";
    const groupModels = groups[groupKey];
    h4.addEventListener("click", () => {
      const allChecked = groupModels.every((m) => checkedModels.has(m));
      for (const m of groupModels) {
        if (allChecked) checkedModels.delete(m); else checkedModels.add(m);
      }
      syncModelCheckboxStates();
      renderChart();
    });
    catDiv.appendChild(h4);

    for (const modelDir of groupModels) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checkedModels.has(modelDir);
      checkbox.dataset.model = modelDir;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) checkedModels.add(modelDir);
        else checkedModels.delete(modelDir);
        renderChart();
      });

      const colorDot = document.createElement("span");
      colorDot.className = "model-color-dot";
      colorDot.style.backgroundColor = getModelColor(modelDir);

      label.appendChild(checkbox);
      label.appendChild(colorDot);
      label.appendChild(document.createTextNode(" " + getModelLabel(modelDir)));
      attachModelTooltip(label, modelDir);
      catDiv.appendChild(label);
    }
    grid.appendChild(catDiv);
  }
}

function syncModelCheckboxStates() {
  document.querySelectorAll("#model-checkbox-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = checkedModels.has(cb.dataset.model);
  });
}

// ============================================================
// Generic tooltip
// ============================================================

let tooltipTimeout = null;

function showTooltip(event, title, body, footer) {
  const tooltip = document.getElementById("custom-tooltip");
  const titleEl = document.getElementById("tooltip-title");
  const bodyEl = document.getElementById("tooltip-body");
  const footerEl = document.getElementById("tooltip-footer");
  titleEl.textContent = title || "";
  titleEl.style.display = title ? "" : "none";
  bodyEl.textContent = body || "";
  bodyEl.style.display = body ? "" : "none";
  footerEl.textContent = footer || "";
  footerEl.style.display = footer ? "" : "none";
  positionTooltip(tooltip, event);
  tooltip.classList.add("visible");
}

function hideTooltip() {
  clearTimeout(tooltipTimeout);
  document.getElementById("custom-tooltip").classList.remove("visible");
}

function positionTooltip(tooltip, event) {
  const pad = 12;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  tooltip.classList.add("visible");
  const rect = tooltip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - pad) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - pad) y = event.clientY - rect.height - pad;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

function attachTooltip(element, contentFn) {
  element.addEventListener("mouseenter", (e) => {
    tooltipTimeout = setTimeout(() => { const c = contentFn(); if (c) showTooltip(e, c.title, c.body, c.footer); }, 300);
  });
  element.addEventListener("mousemove", (e) => {
    const tooltip = document.getElementById("custom-tooltip");
    if (tooltip.classList.contains("visible")) positionTooltip(tooltip, e);
  });
  element.addEventListener("mouseleave", () => hideTooltip());
}

function attachModelTooltip(element, modelDir) {
  attachTooltip(element, () => {
    const info = (DATA.model_info || {})[modelDir];
    if (!info) return null;
    const footer = info.huggingface_url ? info.huggingface_url.replace("https://huggingface.co/", "hf.co/") : "";
    return { title: getModelLabel(modelDir), body: info.description || "", footer };
  });
}

function attachTaskTooltip(element, bench) {
  attachTooltip(element, () => {
    const info = DATA.metrics_setup[bench];
    if (!info) return null;
    const body = info.description || "";
    const footer = info.url ? info.url.replace("https://huggingface.co/", "hf.co/") : "";
    return { title: info.pretty_name, body, footer };
  });
}

// ============================================================
// Chart rendering dispatcher
// ============================================================

function renderChart() {
  // Show/hide metric selector based on task selection
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) {
    hideMetricSelector();
  } else if (sel.startsWith("__group__")) {
    const g = DATA.task_groups[sel.slice(9)];
    if (g) populateMetricSelector(g.benchmarks);
  } else if (DATA.metrics_setup[sel]) {
    populateMetricSelector([sel]);
  }

  updateDescription();
  // Hide model checkboxes on progress tab (only one model)
  const modelSection = document.getElementById("model-checkboxes");
  if (modelSection) modelSection.style.display = currentTab === "progress" ? "none" : "";
  if (currentTab === "comparison") renderComparisonChart();
  else renderProgressChart();
  stateToUrl();
}

/** Look up description for a subtask metric like "acc: Person: 1→2".
 *  Returns the subtask description string, or null if not a subtask metric. */
function getSubtaskDescription(benchmark, metric) {
  if (!metric || metric.indexOf(": ") === -1) return null;
  const info = DATA.metrics_setup[benchmark];
  if (!info || !info.subtasks) return null;
  // Find the subtask whose pretty_name matches the label portion
  const base = getBaseMetric(metric);
  const label = metric.slice(base.length + 2); // e.g. "Person: 1→2"
  for (const st of Object.values(info.subtasks)) {
    if (st.pretty_name === label) return st.description || null;
  }
  return null;
}

function updateDescription() {
  const descEl = document.getElementById("task-description");
  if (!descEl) return;
  const sel = currentTaskSelection;
  let desc = "";
  let url = "";
  let metricDesc = "";
  if (isAggregateSelection(sel)) {
    desc = getAggregateDescription();
  } else if (sel.startsWith("__group__")) {
    const g = DATA.task_groups[sel.slice(9)];
    if (g) {
      const info = DATA.metrics_setup[g.benchmarks[0]];
      if (info) {
        desc = info.description || "";
        url = info.url || "";
        const metric = getEffectiveMetric(g.benchmarks[0]);
        const metricName = METRIC_DISPLAY[metric] || metric;
        const baseMetric = getBaseMetric(metric);
        const subtaskDesc = getSubtaskDescription(g.benchmarks[0], metric);
        if (subtaskDesc) {
          metricDesc = "Metric: " + metricName + ". " + subtaskDesc;
        } else {
          metricDesc = "Metric: " + metricName + ". " + (METRIC_DESCRIPTIONS[baseMetric] || METRIC_DESCRIPTIONS[metric] || "");
        }
      }
    }
  } else if (DATA.metrics_setup[sel]) {
    desc = DATA.metrics_setup[sel].description || "";
    url = DATA.metrics_setup[sel].url || "";
    const metric = getEffectiveMetric(sel);
    const metricName = METRIC_DISPLAY[metric] || metric;
    const baseMetric = getBaseMetric(metric);
    // For subtask metrics, show the subtask description
    const subtaskDesc = getSubtaskDescription(sel, metric);
    if (subtaskDesc) {
      metricDesc = "Metric: " + metricName + ". " + subtaskDesc;
    } else {
      metricDesc = "Metric: " + metricName + ". " + (METRIC_DESCRIPTIONS[baseMetric] || METRIC_DESCRIPTIONS[metric] || "");
    }
  }
  descEl.innerHTML = "";
  if (desc) {
    descEl.appendChild(document.createTextNode(desc));
    if (url) {
      descEl.appendChild(document.createElement("br"));
      const displayUrl = url.replace("https://huggingface.co/", "https://hf.co/");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = displayUrl;
      link.style.color = "var(--accent)";
      descEl.appendChild(link);
    }
    if (metricDesc) {
      const metricSpan = document.createElement("span");
      metricSpan.className = "metric-description";
      metricSpan.textContent = metricDesc;
      descEl.appendChild(metricSpan);
    }
  }
  descEl.style.display = desc ? "block" : "none";
}

function getAggregateDescription() {
  const sel = currentTaskSelection;
  const count = sel === "__custom__" ? checkedTasks.size : getBenchmarksForSelection(sel).filter((b) => checkedTasks.has(b)).length;
  const macro = isMacroSelection();
  let scope = "";
  if (sel === "__all_macro__") {
    const groups = getMacroGroups(checkedTasks);
    scope = "all " + count + " tasks (" + groups.length + " categories, macro-averaged)";
  } else if (sel === "__all__") scope = "all " + count + " tasks (micro-averaged)";
  else if (sel === "__custom__") scope = count + " selected tasks (micro-averaged)";
  else if (sel.startsWith("__cat__")) scope = count + " tasks in the \"" + sel.slice(7) + "\" category";
  else if (sel.startsWith("__eval__")) scope = count + " " + sel.slice(8) + " tasks";
  else if (sel === "__lang__nob") scope = count + " Bokm\u00e5l tasks";
  else if (sel === "__lang__nno") scope = count + " Nynorsk tasks";
  else if (sel === "__lang__sme") scope = count + " Northern S\u00e1mi tasks";

  const avgDesc = macro
    ? "Scores are first averaged within each task category, then averaged across categories. This gives equal weight to each category regardless of how many tasks it contains. "
    : "";
  const normDescs = {
    none: "Scores are shown on their native metric scales without normalization, then averaged.",
    baseline: "Each task score is normalized to a 0\u2013100 scale where 0 = random baseline performance and 100 = perfect score, then averaged across tasks. This accounts for different chance levels across tasks (e.g. 25% for 4-choice QA vs. 50% for binary classification).",
    minmax: "Each task score is normalized to 0\u2013100 using the minimum and maximum scores observed across all models for that task, then averaged. This shows relative performance within the evaluated model set.",
    zscore: "Each task score is converted to a z-score (number of standard deviations from the mean across models), then averaged. This gives equal weight to all tasks regardless of score spread.",
    percentile: "Each task score is converted to a percentile rank (0 = worst model, 100 = best model) across all evaluated models, then averaged.",
  };
  const normDesc = normDescs[currentNormalization] || "";
  return "Aggregate score across " + scope + ". " + avgDesc + normDesc;
}

// ============================================================
// Model Comparison charts
// ============================================================

function renderComparisonChart() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) renderAggregateBarChart();
  else if (sel.startsWith("__group__")) renderGroupedBarChart(sel.slice(9));
  else renderSingleBenchmarkBarChart(sel);
}

function getModelList() {
  return Object.keys(DATA.models).filter((m) => checkedModels.has(m))
    .sort((a, b) => getModelLabel(a).localeCompare(getModelLabel(b)));
}

function getModelLabel(modelDir) {
  return DATA.model_display_names[modelDir] || modelDir;
}

function getPlotlyLayout(overrides) {
  const result = Object.assign({
    font: { family: "Inter, system-ui, sans-serif", size: 13 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 60, r: 20, t: 50, b: 100 },
    autosize: true,
    hovermode: "closest",
  }, overrides);
  // Deep-merge: ensure automargin is always set so tilted labels aren't clipped
  result.xaxis = Object.assign({ automargin: true }, result.xaxis);
  return result;
}

function plotChart(traces, layout) {
  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
  const chartEl = document.getElementById("chart");
  chartEl.on("plotly_hover", onChartHover);
  chartEl.on("plotly_unhover", hideTooltip);
}

function onChartHover(data) {
  if (!data.points || !data.points.length) return;
  const pt = data.points[0];
  if (pt.y == null) return;
  const fmt = currentNormalization === "zscore" ? 2 : 1;
  const scoreStr = Number(pt.y).toFixed(fmt);
  const isProgress = currentTab === "progress";
  const sel = currentTaskSelection;

  // Extract stderr from customdata if available
  let seStr = "";
  if (showStderr && pt.customdata != null) {
    if (isAggregateSelection(sel)) {
      // customdata is {count, stderr}
      const cd = pt.customdata;
      if (cd && typeof cd === "object" && cd.stderr != null) {
        seStr = " \u00b1 " + Number(cd.stderr).toFixed(fmt);
      }
    } else if (typeof pt.customdata === "number" && pt.customdata > 0) {
      seStr = " \u00b1 " + Number(pt.customdata).toFixed(fmt);
    }
  }

  let title = isProgress ? "Step " + pt.x : String(pt.x);
  let body;
  if (isAggregateSelection(sel)) {
    const unit = isMacroSelection() ? "categories" : "tasks";
    const cd = pt.customdata;
    const countStr = cd && typeof cd === "object" ? cd.count : cd;
    body = "Average: " + scoreStr + seStr + (countStr != null ? " (" + countStr + " " + unit + ")" : "");
  } else if (sel.startsWith("__group__") && pt.data.name) {
    body = pt.data.name + ": " + scoreStr + seStr;
  } else {
    body = "Score: " + scoreStr + seStr;
  }
  showTooltip(data.event, title, body);
}

function renderAggregateBarChart() {
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const scores = [];
  const taskCounts = [];
  const aggStderrs = [];
  const colors = modelNames.map(getModelColor);

  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const macro = isMacroSelection();
  for (const m of modelNames) {
    const result = aggregateScores(checkedTasks, (bench) => {
      const raw = getScore(DATA.models, m, bench, currentShot);
      if (raw === undefined) return undefined;
      const allRaw = needAllRaw
        ? modelNames.map((mm) => getScore(DATA.models, mm, bench, currentShot)).filter((v) => v !== undefined)
        : null;
      const score = applyNorm(raw, bench, allRaw);
      const se = wantSE ? scaleStderr(getCombinedSE(DATA.models, m, bench, currentShot), bench) : undefined;
      return { score, stderr: se };
    }, macro);
    scores.push(result ? result.score : 0);
    taskCounts.push(result ? result.count : 0);
    aggStderrs.push(result ? result.stderr : 0);
  }

  const fmt = currentNormalization === "zscore" ? 2 : 1;
  const trace = {
    x: labels, y: scores, type: "bar",
    marker: { color: colors, line: { width: 0 } },
    customdata: taskCounts.map((c, i) => ({ count: c, stderr: aggStderrs[i] })),
    hoverinfo: "none",
  };
  const traces = [trace];
  if (wantSE) {
    trace.error_y = {
      type: "data", array: aggStderrs, visible: true,
      color: "rgba(0,0,0,0.35)", thickness: 1.5, width: 4,
    };
  }

  const avgLabel = macro ? "macro-avg" : "micro-avg";
  const yRange = computeAggregateYRange(DATA.models, checkedTasks);
  const layoutOpts = {
    title: { text: getAggregateLabel() + " \u2014 " + avgLabel + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    xaxis: { title: "" },
    showlegend: false,
    annotations: labels.map((label, i) => ({
      x: label, y: scores[i] + (wantSE ? (aggStderrs[i] || 0) : 0),
      text: scores[i].toFixed(fmt), showarrow: false, yshift: 10,
      xanchor: "center",
    })),
  };
  plotChart(traces, getPlotlyLayout(layoutOpts));
}

function renderGroupedBarChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const metric = getEffectiveMetric(group.benchmarks[0]);
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const bench0 = group.benchmarks[0];
  const useNorm = currentNormalization !== "none";
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";

  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const fmt = currentNormalization === "zscore" ? 2 : 1;
  const groupValuesArr = [];  // per-group values for annotations
  const groupSeArrs = [];     // per-group SE arrays for annotations
  const dataTraces = group.benchmarks.map((bench, i) => {
    const allRaw = needAllRaw
      ? modelNames.map((mm) => getScore(DATA.models, mm, bench, currentShot, metric)).filter((v) => v !== undefined)
      : null;
    const values = modelNames.map((m) => {
      const raw = getScore(DATA.models, m, bench, currentShot, metric);
      if (raw == null) return null;
      return useNorm ? applyNorm(raw, bench, allRaw, metric) : toDisplayScale(raw, bench, metric);
    });
    const seValues = wantSE ? modelNames.map((m) => {
      const se = getCombinedSE(DATA.models, m, bench, currentShot, metric);
      return scaleStderr(se, bench, metric);
    }) : null;
    const barColors = modelNames.map((m) => {
      const base = getModelColor(m);
      return i === 0 ? base : darkenColor(base, 0.3);
    });
    const seArr = seValues ? seValues.map((v) => v || 0) : null;
    const trace = {
      x: labels, y: values, name: group.labels[i], type: "bar",
      legendgroup: group.labels[i], offsetgroup: String(i),
      marker: { color: barColors, line: { width: 0 } },
      customdata: seValues || values.map(() => null),
      hoverinfo: "none",
      showlegend: true,
    };
    if (wantSE && seArr) {
      trace.error_y = {
        type: "data", array: seArr, visible: true,
        color: "rgba(0,0,0,0.35)", thickness: 1.5, width: 4,
      };
    }
    groupValuesArr.push(values);
    groupSeArrs.push(seArr);
    return trace;
  });

  const yLabel = useNorm ? getNormYLabel() : getMetricYLabel(bench0, metric);
  let yRange;
  if (useNorm) {
    // Compute y-range using normalization across all benchmarks in group
    const vals = [];
    for (const shot of ALL_SHOTS) {
      for (const bench of group.benchmarks) {
        const raws = modelNames.map((m) => getScore(DATA.models, m, bench, shot, metric)).filter((v) => v !== undefined);
        for (const raw of raws) vals.push(applyNorm(raw, bench, needAllRaw ? raws : null, metric));
      }
    }
    yRange = computeYRange(vals);
  } else {
    yRange = [0, computeRawYMax_display(DATA.models, group.benchmarks, metric)];
  }
  const nGroups = groupValuesArr.length;
  const barWidth = 0.8 / nGroups; // (1 - default bargap 0.2) / nGroups
  const annotations = [];
  labels.forEach((_, catIdx) => {
    groupValuesArr.forEach((values, gi) => {
      if (values[catIdx] == null) return;
      const se = (wantSE && groupSeArrs[gi]) ? groupSeArrs[gi][catIdx] : 0;
      annotations.push({
        x: catIdx + (gi - (nGroups - 1) / 2) * barWidth,
        y: values[catIdx] + se,
        text: values[catIdx].toFixed(fmt),
        showarrow: false, yshift: 10,
        xanchor: "center",
      });
    });
  });
  const layoutOpts = {
    title: { text: groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    barmode: "group",
    legend: { orientation: "h", x: 0.01, y: 0.99, xanchor: "left", yanchor: "bottom",
              bgcolor: "rgba(255,255,255,0.8)", bordercolor: "#e2e8f0", borderwidth: 1 },
    annotations: annotations,
  };
  plotChart(dataTraces, getPlotlyLayout(layoutOpts));
}

function renderSingleBenchmarkBarChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;
  const metric = getEffectiveMetric(benchmark);
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const colors = modelNames.map(getModelColor);
  const allRaw = (currentNormalization !== "none")
    ? modelNames.map((mm) => getScore(DATA.models, mm, benchmark, currentShot, metric)).filter((v) => v !== undefined)
    : null;
  const values = modelNames.map((m) => {
    const raw = getScore(DATA.models, m, benchmark, currentShot, metric);
    if (raw == null) return null;
    if (currentNormalization === "none") return toDisplayScale(raw, benchmark, metric);
    return applyNorm(raw, benchmark, allRaw, metric);
  });

  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const seValues = wantSE ? modelNames.map((m) => {
    const se = getCombinedSE(DATA.models, m, benchmark, currentShot, metric);
    return scaleStderr(se, benchmark, metric);
  }) : null;

  const yRange = computeSingleYRange(DATA.models, benchmark, metric);
  const yLabel = currentNormalization === "none" ? getMetricYLabel(benchmark, metric) : getNormYLabel();
  const fmt = currentNormalization === "zscore" ? 2 : 1;

  const seArr = seValues ? seValues.map((v) => v || 0) : null;
  const trace = {
    x: labels, y: values, type: "bar",
    marker: { color: colors, line: { width: 0 } },
    customdata: seValues || values.map(() => null),
    hoverinfo: "none",
  };
  const traces = [trace];
  if (wantSE && seArr) {
    trace.error_y = {
      type: "data", array: seArr, visible: true,
      color: "rgba(0,0,0,0.35)", thickness: 1.5, width: 4,
    };
  }
  const layoutOpts = {
    title: { text: info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    showlegend: false,
    annotations: labels.map((label, i) => ({
      x: label, y: (values[i] || 0) + (wantSE && seArr ? (seArr[i] || 0) : 0),
      text: values[i] != null ? values[i].toFixed(fmt) : "",
      showarrow: false, yshift: 10,
      xanchor: "center",
    })),
  };
  plotChart(traces, getPlotlyLayout(layoutOpts));
}

// ============================================================
// Training Progress charts
// ============================================================

function renderProgressChart() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) renderAggregateProgressChart();
  else if (sel.startsWith("__group__")) renderGroupProgressChart(sel.slice(9));
  else renderSingleProgressChart(sel);
}

function getSteps() {
  return Object.keys(DATA.progress).map(Number).sort((a, b) => a - b);
}

/** Create a shaded band trace around a line trace for SE visualization. */
function makeBandTrace(xValues, yValues, seValues, color) {
  const upper = [], lower = [], xs = [];
  for (let i = 0; i < xValues.length; i++) {
    if (yValues[i] != null && seValues[i] != null) {
      xs.push(xValues[i]);
      upper.push(yValues[i] + seValues[i]);
      lower.push(yValues[i] - seValues[i]);
    }
  }
  if (xs.length === 0) return null;
  return {
    x: xs.concat(xs.slice().reverse()),
    y: upper.concat(lower.slice().reverse()),
    fill: "toself",
    fillcolor: hexToRgba(color, 0.15),
    line: { color: "transparent" },
    showlegend: false,
    hoverinfo: "skip",
  };
}

function renderAggregateProgressChart() {
  const steps = getSteps();
  const allStepEntities = steps.map(String);
  const macro = isMacroSelection();
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const aggResults = steps.map((step) => {
    return aggregateScores(checkedTasks, (bench) => {
      const raw = getScore(DATA.progress, step, bench, currentShot);
      if (raw === undefined) return undefined;
      const allRaw = needAllRaw
        ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, currentShot)).filter((v) => v !== undefined)
        : null;
      const score = applyNorm(raw, bench, allRaw);
      const se = wantSE ? scaleStderr(getCombinedSE(DATA.progress, step, bench, currentShot), bench) : undefined;
      return { score, stderr: se };
    }, macro);
  });
  const scores = aggResults.map((r) => r ? r.score : null);
  const aggSes = aggResults.map((r) => r ? r.stderr : null);

  const traces = [];
  if (wantSE) {
    const band = makeBandTrace(steps, scores, aggSes, MODEL_COLORS[0]);
    if (band) traces.push(band);
  }
  traces.push({
    x: steps, y: scores, mode: "lines+markers", name: "NorOLMo",
    line: { color: MODEL_COLORS[0], width: 2.5 }, marker: { size: 5 },
    customdata: aggResults.map((r) => r ? { count: r.count, stderr: r.stderr } : null),
    hoverinfo: "none",
  });
  const avgLabel = macro ? "macro-avg" : "micro-avg";
  const yRange = computeProgressAggregateYRange();
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + getAggregateLabel() + " \u2014 " + avgLabel + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    showlegend: false,
  });
  plotChart(traces, layout);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const metric = getEffectiveMetric(group.benchmarks[0]);
  const steps = getSteps();
  const allStepEntities = steps.map(String);
  const bench0 = group.benchmarks[0];
  const useNorm = currentNormalization !== "none";
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const fmt = currentNormalization === "zscore" ? 2 : 1;

  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const traces = [];
  group.benchmarks.forEach((bench, i) => {
    const allRaw = needAllRaw
      ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, currentShot, metric)).filter((v) => v !== undefined)
      : null;
    const ys = steps.map((s) => {
      const raw = getScore(DATA.progress, s, bench, currentShot, metric);
      if (raw == null) return null;
      return useNorm ? applyNorm(raw, bench, allRaw, metric) : toDisplayScale(raw, bench, metric);
    });
    const ses = wantSE ? steps.map((s) => {
      const se = getCombinedSE(DATA.progress, s, bench, currentShot, metric);
      return scaleStderr(se, bench, metric);
    }) : null;
    const lineColor = PROGRESS_PAIR_COLORS[i % PROGRESS_PAIR_COLORS.length];
    if (wantSE && ses) {
      const band = makeBandTrace(steps, ys, ses, lineColor);
      if (band) traces.push(band);
    }
    traces.push({
      x: steps, y: ys, mode: "lines+markers", name: group.labels[i],
      line: { color: lineColor, width: 2.5 },
      marker: { size: 5 },
      customdata: ses || ys.map(() => null),
      hoverinfo: "none",
    });
  });

  const yLabel = useNorm ? getNormYLabel() : getMetricYLabel(bench0, metric);
  let yRange;
  if (useNorm) {
    const vals = [];
    for (const shot of ALL_SHOTS) {
      for (const bench of group.benchmarks) {
        const raws = allStepEntities.map((s) => getScore(DATA.progress, s, bench, shot, metric)).filter((v) => v !== undefined);
        for (const raw of raws) vals.push(applyNorm(raw, bench, needAllRaw ? raws : null, metric));
      }
    }
    yRange = computeYRange(vals);
  } else {
    yRange = [0, computeRawYMax_display(DATA.progress, group.benchmarks, metric)];
  }
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
  });
  plotChart(traces, layout);
}

function renderSingleProgressChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;
  const metric = getEffectiveMetric(benchmark);
  const steps = getSteps();
  const wantSE = (showStderr || showPromptDeviation) && isStderrCompatible();
  const ys = steps.map((s) => {
    const raw = getScore(DATA.progress, s, benchmark, currentShot, metric);
    return raw != null ? toDisplayScale(raw, benchmark, metric) : null;
  });
  const ses = wantSE ? steps.map((s) => {
    const se = getCombinedSE(DATA.progress, s, benchmark, currentShot, metric);
    return scaleStderr(se, benchmark, metric);
  }) : null;
  const yMax = computeRawYMax_display(DATA.progress, [benchmark], metric);
  const traces = [];
  if (wantSE && ses) {
    const band = makeBandTrace(steps, ys, ses, MODEL_COLORS[0]);
    if (band) traces.push(band);
  }
  traces.push({
    x: steps, y: ys, mode: "lines+markers", name: info.pretty_name,
    line: { color: MODEL_COLORS[0], width: 2.5 }, marker: { size: 5 },
    customdata: ses || ys.map(() => null),
    hoverinfo: "none",
  });
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getMetricYLabel(benchmark, metric), range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
    showlegend: false,
  });
  plotChart(traces, layout);
}

// ============================================================
// Y-axis max helpers
// ============================================================

const ALL_SHOTS = ["0", "1", "5"];

/** Compute [yMin, yMax] range from an array of values.
 *  For non-negative modes, yMin is 0. For z-score, yMin can be negative. */
function computeYRange(values) {
  if (!values.length) return currentNormalization === "zscore" ? [-2, 2] : [0, 100];
  const mx = Math.max(...values);
  const mn = Math.min(...values);
  if (currentNormalization === "zscore") {
    const pad = Math.max((mx - mn) * 0.15, 0.3);
    return [mn - pad, mx + pad];
  }
  return [0, Math.min(mx + Math.max(mx * 0.15, 2), 115)];
}

function computeAggregateYRange(dataSource, benchmarks) {
  const allAvgs = [];
  const entities = Object.keys(dataSource);
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const macro = isMacroSelection();
  for (const shot of ALL_SHOTS) {
    const modelNames = dataSource === DATA.models ? getModelList() : null;
    for (const entity of entities) {
      if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
      const result = aggregateScores(benchmarks, (bench) => {
        const raw = getScore(dataSource, entity, bench, shot);
        if (raw === undefined) return undefined;
        if (needAllRaw && modelNames) {
          const allRaw = modelNames.map((mm) => getScore(dataSource, mm, bench, shot)).filter((v) => v !== undefined);
          return applyNorm(raw, bench, allRaw);
        }
        return applyNorm(raw, bench, null);
      }, macro);
      if (result) allAvgs.push(result.score);
    }
  }
  return computeYRange(allAvgs);
}

function computeRawYMax_display(dataSource, benchmarks, metric) {
  const vals = [];
  for (const entity of Object.keys(dataSource)) {
    if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
    for (const shot of ALL_SHOTS)
      for (const bench of benchmarks) {
        const v = getScore(dataSource, entity, bench, shot, metric);
        if (v != null) vals.push(toDisplayScale(v, bench, metric));
      }
  }
  if (!vals.length) return 100;
  const mx = Math.max(...vals);
  return Math.min(mx + Math.max(mx * 0.15, 2), 115);
}

function computeSingleYRange(dataSource, benchmark, metric) {
  const vals = [];
  const entities = Object.keys(dataSource).filter((e) => dataSource !== DATA.models || checkedModels.has(e));
  for (const shot of ALL_SHOTS) {
    const raws = entities.map((e) => getScore(dataSource, e, benchmark, shot, metric)).filter((v) => v !== undefined);
    for (const raw of raws) {
      if (currentNormalization === "none") vals.push(toDisplayScale(raw, benchmark, metric));
      else vals.push(applyNorm(raw, benchmark, raws, metric));
    }
  }
  return computeYRange(vals);
}

function computeProgressAggregateYRange() {
  const allAvgs = [];
  const allStepEntities = Object.keys(DATA.progress);
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const macro = isMacroSelection();
  for (const shot of ALL_SHOTS) {
    for (const step of allStepEntities) {
      const result = aggregateScores(checkedTasks, (bench) => {
        const raw = getScore(DATA.progress, step, bench, shot);
        if (raw === undefined) return undefined;
        const allRaw = needAllRaw
          ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, shot)).filter((v) => v !== undefined)
          : null;
        return applyNorm(raw, bench, allRaw);
      }, macro);
      if (result) allAvgs.push(result.score);
    }
  }
  return computeYRange(allAvgs);
}

function getAggregateLabel() {
  const sel = currentTaskSelection;
  if (sel === "__all_macro__" || sel === "__all__") return "all tasks";
  if (sel === "__custom__") return checkedTasks.size + " tasks";
  if (sel.startsWith("__cat__")) return sel.slice(7);
  if (sel.startsWith("__eval__")) return sel.slice(8) + " tasks";
  if (sel === "__lang__nob") return "Bokm\u00e5l tasks";
  if (sel === "__lang__nno") return "Nynorsk tasks";
  if (sel === "__lang__sme") return "Northern S\u00e1mi tasks";
  return "aggregate";
}

// ============================================================
// Entry point
// ============================================================

document.addEventListener("DOMContentLoaded", init);
