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
  acc: "accuracy (0\u2013100)",
  f1: "F1 (0\u2013100)",
  em: "exact match (0\u2013100)",
  bleu: "BLEU",
  rougeL_max: "ROUGE-L",
  errant_f05: "ERRANT F0.5 (0\u2013100)",
  chrf: "chrF",
};

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
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
  const allModels = Object.keys(DATA.models);
  return MODEL_COLORS[allModels.indexOf(modelDir) % MODEL_COLORS.length];
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
// Initialization
// ============================================================

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();

  const defaultModels = DATA.default_models || Object.keys(DATA.models);
  checkedModels = new Set(defaultModels.filter((m) => m in DATA.models));

  populateTaskDropdown();
  checkedTasks = new Set(Object.keys(DATA.metrics_setup));
  bindEventListeners();
  buildCheckboxes();
  buildModelCheckboxes();
  autoSetNormalization();
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
      const info = DATA.metrics_setup[bench];
      const label = document.createElement("label");
      if (info.description) label.title = info.description;

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
      catDiv.appendChild(label);
    }
    grid.appendChild(catDiv);
  }
}

function onTaskCheckboxChange() {
  // If exactly 1 task checked, switch to individual view
  if (checkedTasks.size === 1) {
    const bench = [...checkedTasks][0];
    const ddVal = findDropdownValueForBench(bench);
    if (ddVal) {
      currentTaskSelection = ddVal;
      document.getElementById("task-select").value = ddVal;
      autoSetNormalization();
      renderChart();
      return;
    }
  }
  // If exactly 2 tasks that form a group, switch to group view
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
// Chart rendering dispatcher
// ============================================================

function renderChart() {
  updateDescription();
  // Hide model checkboxes on progress tab (only one model)
  const modelSection = document.getElementById("model-checkboxes");
  if (modelSection) modelSection.style.display = currentTab === "progress" ? "none" : "";
  if (currentTab === "comparison") renderComparisonChart();
  else renderProgressChart();
}

function updateDescription() {
  const descEl = document.getElementById("task-description");
  if (!descEl) return;
  const sel = currentTaskSelection;
  let desc = "";
  if (sel.startsWith("__group__")) {
    const g = DATA.task_groups[sel.slice(9)];
    if (g) { const info = DATA.metrics_setup[g.benchmarks[0]]; if (info) desc = info.description || ""; }
  } else if (!isAggregateSelection(sel) && DATA.metrics_setup[sel]) {
    desc = DATA.metrics_setup[sel].description || "";
  }
  descEl.textContent = desc;
  descEl.style.display = desc ? "block" : "none";
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
  return Object.keys(DATA.models).filter((m) => checkedModels.has(m));
}

function getModelLabel(modelDir) {
  return DATA.model_display_names[modelDir] || modelDir;
}

function getPlotlyLayout(overrides) {
  return Object.assign({
    font: { family: "Inter, system-ui, sans-serif", size: 13 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 60, r: 20, t: 50, b: 100 },
    autosize: true,
  }, overrides);
}

function renderAggregateBarChart() {
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const scores = [];
  const hoverTexts = [];
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
    const avg = count > 0 ? sum / count : 0;
    scores.push(avg);
    hoverTexts.push(getModelLabel(m) + "<br>Avg: " + avg.toFixed(2) + " (" + count + " tasks)");
  }

  const trace = {
    x: labels, y: scores, type: "bar",
    marker: { color: colors, line: { width: 0 } },
    text: scores.map((s) => s.toFixed(currentNormalization === "zscore" ? 2 : 1)),
    textposition: "outside",
    hovertext: hoverTexts, hoverinfo: "text",
  };

  const yRange = computeAggregateYRange(DATA.models, checkedTasks);
  const layout = getPlotlyLayout({
    title: { text: getAggregateLabel() + " \u2014 aggregate (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
    xaxis: { title: "" },
  });
  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupedBarChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const bench0 = group.benchmarks[0];

  const dataTraces = group.benchmarks.map((bench, i) => {
    const values = modelNames.map((m) => {
      const raw = getScore(DATA.models, m, bench, currentShot);
      return raw != null ? toDisplayScale(raw, bench) : null;
    });
    const barColors = modelNames.map((m) => {
      const base = getModelColor(m);
      return i === 0 ? base : darkenColor(base, 0.3);
    });
    return {
      x: labels, y: values, name: group.labels[i], type: "bar",
      legendgroup: group.labels[i],
      marker: { color: barColors, line: { width: 0 } },
      text: values.map((v) => (v !== null ? v.toFixed(1) : "")), textposition: "outside",
      hovertemplate: "%{x}<br>" + group.labels[i] + ": %{y:.1f}<extra></extra>",
      showlegend: true,
    };
  });

  const yMax = computeRawYMax_display(DATA.models, group.benchmarks);
  const layout = getPlotlyLayout({
    title: { text: groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: getMetricYLabel(bench0), range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
    barmode: "group",
    legend: { x: 0.01, y: 0.99, xanchor: "left", yanchor: "top",
              bgcolor: "rgba(255,255,255,0.8)", bordercolor: "#e2e8f0", borderwidth: 1 },
  });
  Plotly.newPlot("chart", dataTraces, layout, PLOTLY_CONFIG);
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
    hovertemplate: "%{x}: %{y:." + fmt + "f}<extra></extra>",
  };
  const layout = getPlotlyLayout({
    title: { text: info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: yLabel, range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
  });
  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
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

  const fmt = currentNormalization === "zscore" ? 2 : 1;
  const trace = {
    x: steps, y: scores, mode: "lines+markers", name: "NorOLMo",
    line: { color: MODEL_COLORS[0], width: 2.5 }, marker: { size: 5 },
    hovertemplate: "Step %{x}<br>Score: %{y:." + fmt + "f}<extra></extra>",
  };
  const yRange = computeProgressAggregateYRange();
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + getAggregateLabel() + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getNormYLabel(), range: yRange, gridcolor: "#f0f0f0", zeroline: currentNormalization === "zscore" },
  });
  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;
  const steps = getSteps();
  const bench0 = group.benchmarks[0];

  const traces = group.benchmarks.map((bench, i) => {
    const ys = steps.map((s) => {
      const raw = getScore(DATA.progress, s, bench, currentShot);
      return raw != null ? toDisplayScale(raw, bench) : null;
    });
    return {
      x: steps, y: ys, mode: "lines+markers", name: group.labels[i],
      line: { width: 2.5 }, marker: { size: 5 },
      hovertemplate: group.labels[i] + "<br>Step %{x}: %{y:.1f}<extra></extra>",
    };
  });

  const yMax = computeRawYMax_display(DATA.progress, group.benchmarks);
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getMetricYLabel(bench0), range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });
  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
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
    hovertemplate: "Step %{x}: %{y:.1f}<extra></extra>",
  };
  const layout = getPlotlyLayout({
    title: { text: "NorOLMo progress \u2014 " + info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: getMetricYLabel(benchmark), range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });
  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
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
