// NorEval Benchmark Visualization
// ================================

let DATA = null;
let currentTab = "comparison";
let currentShot = "5";
let currentTaskSelection = "__all__";
let currentPromptAgg = "max";
let currentNormalization = "baseline"; // auto-set based on view
let checkedTasks = new Set();
let checkedModels = new Set();

const MODEL_COLORS = [
  "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#14b8a6", "#f97316",
  "#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#0ea5e9",
];

const METRIC_DISPLAY = {
  acc: "accuracy",
  f1: "F1",
  em: "exact match",
  bleu: "BLEU",
  rougeL_max: "ROUGE-L",
  errant_f05: "ERRANT F0.5",
  chrf: "chrF",
};

const PROGRESS_PAIR_COLORS = ["#3b82f6", "#ef4444"]; // blue, red

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: [
    "zoom2d", "pan2d", "select2d", "lasso2d", "zoomIn2d", "zoomOut2d",
    "autoScale2d", "resetScale2d", "hoverClosestCartesian",
    "hoverCompareCartesian", "toggleSpikelines",
  ],
  toImageButtonOptions: {
    format: "png",
    width: 1600,
    height: 900,
    scale: 3,
  },
  modeBarButtonsToAdd: [
    {
      name: "Download as SVG",
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

/** Get raw score from data source, respecting prompt aggregation mode */
function getScore(dataSource, entity, bench, shot) {
  const obj = dataSource[entity]?.[bench]?.[shot];
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj === "number") return obj; // backward compat
  return obj[currentPromptAgg];
}

/** Convert raw stored score to 0-100 display scale */
function toDisplayScale(value, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  return info.metric_scale === "unit" ? value * 100 : value;
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
 *  For min-max, z-score, and percentile, pass allRaw = array of all raw scores for this benchmark. */
function applyNorm(raw, benchmark, allRaw) {
  if (currentNormalization === "none") return toDisplayScale(raw, benchmark);
  if (currentNormalization === "baseline") return baselineNorm(raw, benchmark);
  if (currentNormalization === "minmax") {
    if (!allRaw || allRaw.length < 2) return toDisplayScale(raw, benchmark);
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
  return toDisplayScale(raw, benchmark);
}

function getNormYLabel() {
  if (currentNormalization === "baseline") return "normalized score (baseline=0, perfect=100)";
  if (currentNormalization === "minmax") return "normalized score (min-max across models)";
  if (currentNormalization === "zscore") return "z-score (standard deviations from mean)";
  if (currentNormalization === "percentile") return "percentile rank (0=worst, 100=best)";
  return "score (0\u2013100)";
}

function getMetricYLabel(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  return METRIC_DISPLAY[info.main_metric] || info.main_metric;
}

function autoSetNormalization() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) {
    currentNormalization = "baseline";
  } else {
    currentNormalization = "none";
  }
  document.getElementById("norm-select").value = currentNormalization;
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
  if (currentTaskSelection !== "__all__") {
    params.set("task", _taskSelToAlias[currentTaskSelection] || currentTaskSelection);
  }
  if (currentPromptAgg !== "max") params.set("prompt", currentPromptAgg);

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
  if (params.has("norm")) { currentNormalization = params.get("norm"); loaded = true; }

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
    document.querySelectorAll(".tab-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === currentTab));
    document.querySelectorAll(".shot-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.shot === currentShot));
    syncCheckboxStates();
    syncModelCheckboxStates();
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
    syncCheckboxStates();
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
  return sel === "__all__" || sel.startsWith("__cat__") || sel.startsWith("__lang__") || sel.startsWith("__eval__");
}

function getBenchmarksForSelection(sel) {
  if (sel === "__all__") return Object.keys(DATA.metrics_setup);
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
    catDiv.appendChild(h4);

    for (const bench of grouped[cat]) {
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
  // Otherwise, aggregate
  if (!isAggregateSelection(currentTaskSelection)) {
    currentTaskSelection = "__all__";
    document.getElementById("task-select").value = "__all__";
    autoSetNormalization();
  }
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
    catDiv.appendChild(h4);

    for (const modelDir of groups[groupKey]) {
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
    const metric = METRIC_DISPLAY[info.main_metric] || info.main_metric;
    const body = (info.description || "") + (info.description ? "  \u2022  " : "") + "Metric: " + metric;
    const footer = info.url ? info.url.replace("https://huggingface.co/", "hf.co/") : "";
    return { title: info.pretty_name, body, footer };
  });
}

// ============================================================
// Chart rendering dispatcher
// ============================================================

function renderChart() {
  updateDescription();
  // Hide model checkboxes on progress tab (only one model)
  const modelSection = document.getElementById("model-checkboxes");
  if (modelSection) modelSection.style.display = currentTab === "progress" ? "none" : "";
  if (currentTab === "comparison") renderComparisonChart();
  else renderProgressChart();
  stateToUrl();
}

function updateDescription() {
  const descEl = document.getElementById("task-description");
  if (!descEl) return;
  const sel = currentTaskSelection;
  let desc = "";
  let url = "";
  if (isAggregateSelection(sel)) {
    desc = getAggregateDescription();
  } else if (sel.startsWith("__group__")) {
    const g = DATA.task_groups[sel.slice(9)];
    if (g) {
      const info = DATA.metrics_setup[g.benchmarks[0]];
      if (info) {
        desc = info.description || "";
        url = info.url || "";
      }
    }
  } else if (DATA.metrics_setup[sel]) {
    desc = DATA.metrics_setup[sel].description || "";
    url = DATA.metrics_setup[sel].url || "";
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
  }
  descEl.style.display = desc ? "block" : "none";
}

function getAggregateDescription() {
  const sel = currentTaskSelection;
  const benchmarks = getBenchmarksForSelection(sel);
  const count = benchmarks.filter((b) => checkedTasks.has(b)).length;
  let scope = "";
  if (sel === "__all__") scope = "all " + count + " tasks";
  else if (sel.startsWith("__cat__")) scope = count + " tasks in the \"" + sel.slice(7) + "\" category";
  else if (sel.startsWith("__eval__")) scope = count + " " + sel.slice(8) + " tasks";
  else if (sel === "__lang__nob") scope = count + " Bokm\u00e5l tasks";
  else if (sel === "__lang__nno") scope = count + " Nynorsk tasks";
  else if (sel === "__lang__sme") scope = count + " Northern S\u00e1mi tasks";

  const normDescs = {
    none: "Scores are shown on their native metric scales without normalization, then averaged.",
    baseline: "Each task score is normalized to a 0\u2013100 scale where 0 = random baseline performance and 100 = perfect score, then averaged across tasks. This accounts for different chance levels across tasks (e.g. 25% for 4-choice QA vs. 50% for binary classification).",
    minmax: "Each task score is normalized to 0\u2013100 using the minimum and maximum scores observed across all models for that task, then averaged. This shows relative performance within the evaluated model set.",
    zscore: "Each task score is converted to a z-score (number of standard deviations from the mean across models), then averaged. This gives equal weight to all tasks regardless of score spread.",
    percentile: "Each task score is converted to a percentile rank (0 = worst model, 100 = best model) across all evaluated models, then averaged.",
  };
  const normDesc = normDescs[currentNormalization] || "";
  return "Aggregate score across " + scope + ". " + normDesc;
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

  let title = isProgress ? "Step " + pt.x : String(pt.x);
  let body;
  if (isAggregateSelection(sel)) {
    body = "Average: " + scoreStr + (pt.customdata != null ? " (" + pt.customdata + " tasks)" : "");
  } else if (sel.startsWith("__group__") && pt.data.name) {
    body = pt.data.name + ": " + scoreStr;
  } else {
    body = "Score: " + scoreStr;
  }
  showTooltip(data.event, title, body);
}

function renderAggregateBarChart() {
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const scores = [];
  const taskCounts = [];
  const colors = modelNames.map(getModelColor);

  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  for (const m of modelNames) {
    let sum = 0, count = 0;
    for (const bench of checkedTasks) {
      const raw = getScore(DATA.models, m, bench, currentShot);
      if (raw !== undefined) {
        const allRaw = needAllRaw
          ? modelNames.map((mm) => getScore(DATA.models, mm, bench, currentShot)).filter((v) => v !== undefined)
          : null;
        sum += applyNorm(raw, bench, allRaw);
        count++;
      }
    }
    scores.push(count > 0 ? sum / count : 0);
    taskCounts.push(count);
  }

  const trace = {
    x: labels, y: scores, type: "bar",
    marker: { color: colors, line: { width: 0 } },
    text: scores.map((s) => s.toFixed(currentNormalization === "zscore" ? 2 : 1)),
    textposition: "outside",
    customdata: taskCounts,
    hoverinfo: "none",
  };

  const yRange = computeAggregateYRange(DATA.models, checkedTasks);
  const layout = getPlotlyLayout({
    title: { text: getAggregateLabel() + " \u2014 aggregate (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    xaxis: { title: "" },
  });
  plotChart([trace], layout);
}

function renderGroupedBarChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const bench0 = group.benchmarks[0];
  const useNorm = currentNormalization !== "none";
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";

  const dataTraces = group.benchmarks.map((bench, i) => {
    const allRaw = needAllRaw
      ? modelNames.map((mm) => getScore(DATA.models, mm, bench, currentShot)).filter((v) => v !== undefined)
      : null;
    const values = modelNames.map((m) => {
      const raw = getScore(DATA.models, m, bench, currentShot);
      if (raw == null) return null;
      return useNorm ? applyNorm(raw, bench, allRaw) : toDisplayScale(raw, bench);
    });
    const barColors = modelNames.map((m) => {
      const base = getModelColor(m);
      return i === 0 ? base : darkenColor(base, 0.3);
    });
    const fmt = currentNormalization === "zscore" ? 2 : 1;
    return {
      x: labels, y: values, name: group.labels[i], type: "bar",
      legendgroup: group.labels[i],
      marker: { color: barColors, line: { width: 0 } },
      text: values.map((v) => (v !== null ? v.toFixed(fmt) : "")), textposition: "outside",
      hoverinfo: "none",
      showlegend: true,
    };
  });

  const yLabel = useNorm ? getNormYLabel() : getMetricYLabel(bench0);
  let yRange;
  if (useNorm) {
    // Compute y-range using normalization across all benchmarks in group
    const vals = [];
    for (const shot of ALL_SHOTS) {
      for (const bench of group.benchmarks) {
        const raws = modelNames.map((m) => getScore(DATA.models, m, bench, shot)).filter((v) => v !== undefined);
        for (const raw of raws) vals.push(applyNorm(raw, bench, needAllRaw ? raws : null));
      }
    }
    yRange = computeYRange(vals);
  } else {
    yRange = [0, computeRawYMax_display(DATA.models, group.benchmarks)];
  }
  const layout = getPlotlyLayout({
    title: { text: groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    barmode: "group",
    legend: { orientation: "h", x: 0.01, y: 0.99, xanchor: "left", yanchor: "bottom",
              bgcolor: "rgba(255,255,255,0.8)", bordercolor: "#e2e8f0", borderwidth: 1 },
  });
  plotChart(dataTraces, layout);
}

function renderSingleBenchmarkBarChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const colors = modelNames.map(getModelColor);
  const allRaw = (currentNormalization !== "none")
    ? modelNames.map((mm) => getScore(DATA.models, mm, benchmark, currentShot)).filter((v) => v !== undefined)
    : null;
  const values = modelNames.map((m) => {
    const raw = getScore(DATA.models, m, benchmark, currentShot);
    if (raw == null) return null;
    if (currentNormalization === "none") return toDisplayScale(raw, benchmark);
    return applyNorm(raw, benchmark, allRaw);
  });

  const yRange = computeSingleYRange(DATA.models, benchmark);
  const yLabel = currentNormalization === "none" ? getMetricYLabel(benchmark) : getNormYLabel();
  const fmt = currentNormalization === "zscore" ? 2 : 1;

  const trace = {
    x: labels, y: values, type: "bar",
    marker: { color: colors, line: { width: 0 } },
    text: values.map((v) => (v !== null ? v.toFixed(fmt) : "")), textposition: "outside",
    hoverinfo: "none",
  };
  const layout = getPlotlyLayout({
    title: { text: info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
  });
  plotChart([trace], layout);
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

function renderAggregateProgressChart() {
  const steps = getSteps();
  const allStepEntities = steps.map(String);
  const scores = steps.map((step) => {
    let sum = 0, count = 0;
    for (const bench of checkedTasks) {
      const raw = getScore(DATA.progress, step, bench, currentShot);
      if (raw !== undefined) {
        const allRaw = (currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile")
          ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, currentShot)).filter((v) => v !== undefined)
          : null;
        sum += applyNorm(raw, bench, allRaw);
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  });

  const trace = {
    x: steps, y: scores, mode: "lines+markers", name: "NorOLMo",
    line: { color: MODEL_COLORS[0], width: 2.5 }, marker: { size: 5 },
    hoverinfo: "none",
  };
  const yRange = computeProgressAggregateYRange();
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + getAggregateLabel() + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
  });
  plotChart([trace], layout);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const steps = getSteps();
  const allStepEntities = steps.map(String);
  const bench0 = group.benchmarks[0];
  const useNorm = currentNormalization !== "none";
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  const fmt = currentNormalization === "zscore" ? 2 : 1;

  const traces = group.benchmarks.map((bench, i) => {
    const allRaw = needAllRaw
      ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, currentShot)).filter((v) => v !== undefined)
      : null;
    const ys = steps.map((s) => {
      const raw = getScore(DATA.progress, s, bench, currentShot);
      if (raw == null) return null;
      return useNorm ? applyNorm(raw, bench, allRaw) : toDisplayScale(raw, bench);
    });
    return {
      x: steps, y: ys, mode: "lines+markers", name: group.labels[i],
      line: { color: PROGRESS_PAIR_COLORS[i % PROGRESS_PAIR_COLORS.length], width: 2.5 },
      marker: { size: 5 },
      hoverinfo: "none",
    };
  });

  const yLabel = useNorm ? getNormYLabel() : getMetricYLabel(bench0);
  let yRange;
  if (useNorm) {
    const vals = [];
    for (const shot of ALL_SHOTS) {
      for (const bench of group.benchmarks) {
        const raws = allStepEntities.map((s) => getScore(DATA.progress, s, bench, shot)).filter((v) => v !== undefined);
        for (const raw of raws) vals.push(applyNorm(raw, bench, needAllRaw ? raws : null));
      }
    }
    yRange = computeYRange(vals);
  } else {
    yRange = [0, computeRawYMax_display(DATA.progress, group.benchmarks)];
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
  const steps = getSteps();
  const ys = steps.map((s) => {
    const raw = getScore(DATA.progress, s, benchmark, currentShot);
    return raw != null ? toDisplayScale(raw, benchmark) : null;
  });
  const yMax = computeRawYMax_display(DATA.progress, [benchmark]);
  const trace = {
    x: steps, y: ys, mode: "lines+markers", name: info.pretty_name,
    line: { color: MODEL_COLORS[0], width: 2.5 }, marker: { size: 5 },
    hoverinfo: "none",
  };
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getMetricYLabel(benchmark), range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });
  plotChart([trace], layout);
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
  for (const shot of ALL_SHOTS) {
    for (const entity of entities) {
      if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
      let sum = 0, count = 0;
      const modelNames = dataSource === DATA.models ? getModelList() : null;
      for (const bench of benchmarks) {
        const raw = getScore(dataSource, entity, bench, shot);
        if (raw !== undefined) {
          if (needAllRaw && modelNames) {
            const allRaw = modelNames.map((mm) => getScore(dataSource, mm, bench, shot)).filter((v) => v !== undefined);
            sum += applyNorm(raw, bench, allRaw);
          } else {
            sum += applyNorm(raw, bench, null);
          }
          count++;
        }
      }
      if (count > 0) allAvgs.push(sum / count);
    }
  }
  return computeYRange(allAvgs);
}

function computeRawYMax_display(dataSource, benchmarks) {
  const vals = [];
  for (const entity of Object.keys(dataSource)) {
    if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
    for (const shot of ALL_SHOTS)
      for (const bench of benchmarks) {
        const v = getScore(dataSource, entity, bench, shot);
        if (v != null) vals.push(toDisplayScale(v, bench));
      }
  }
  if (!vals.length) return 100;
  const mx = Math.max(...vals);
  return Math.min(mx + Math.max(mx * 0.15, 2), 115);
}

function computeSingleYRange(dataSource, benchmark) {
  const vals = [];
  const entities = Object.keys(dataSource).filter((e) => dataSource !== DATA.models || checkedModels.has(e));
  for (const shot of ALL_SHOTS) {
    const raws = entities.map((e) => getScore(dataSource, e, benchmark, shot)).filter((v) => v !== undefined);
    for (const raw of raws) {
      if (currentNormalization === "none") vals.push(toDisplayScale(raw, benchmark));
      else vals.push(applyNorm(raw, benchmark, raws));
    }
  }
  return computeYRange(vals);
}

function computeProgressAggregateYRange() {
  const allAvgs = [];
  const allStepEntities = Object.keys(DATA.progress);
  const needAllRaw = currentNormalization === "minmax" || currentNormalization === "zscore" || currentNormalization === "percentile";
  for (const shot of ALL_SHOTS) {
    for (const step of allStepEntities) {
      let sum = 0, count = 0;
      for (const bench of checkedTasks) {
        const raw = getScore(DATA.progress, step, bench, shot);
        if (raw !== undefined) {
          const allRaw = needAllRaw
            ? allStepEntities.map((s) => getScore(DATA.progress, s, bench, shot)).filter((v) => v !== undefined)
            : null;
          sum += applyNorm(raw, bench, allRaw);
          count++;
        }
      }
      if (count > 0) allAvgs.push(sum / count);
    }
  }
  return computeYRange(allAvgs);
}

function getAggregateLabel() {
  const sel = currentTaskSelection;
  if (sel === "__all__") return "all tasks";
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
