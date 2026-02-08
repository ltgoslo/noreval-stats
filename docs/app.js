// NorEval Benchmark Visualization
// ================================

let DATA = null;
let currentTab = "comparison";
let currentShot = "5";
let currentTaskSelection = "__all__";
let checkedTasks = new Set();
let checkedModels = new Set();

// Modern, accessible color palette
const MODEL_COLORS = [
  "#6366f1", // Indigo
  "#f43f5e", // Rose
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#84cc16", // Lime
  "#14b8a6", // Teal
  "#f97316", // Orange
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#22c55e", // Green
  "#a855f7", // Purple
  "#0ea5e9", // Sky
];

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
};

// ============================================================
// Color utilities
// ============================================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")
  );
}

function lightenColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount
  );
}

function darkenColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function getModelColor(modelDir) {
  const allModels = Object.keys(DATA.models);
  const idx = allModels.indexOf(modelDir);
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

// ============================================================
// Score display utilities
// ============================================================

/** Convert a raw stored score to the 0-100 display scale */
function toDisplayScale(value, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (info.metric_scale === "unit") {
    return value * 100;
  }
  return value; // already 0-100
}

/** Normalize score: 0 = random baseline, 100 = perfect */
function normalizeScore(rawScore, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  const baseline = info.random_baseline;
  const maxPerf = info.max_performance;
  if (maxPerf === baseline) return 0;
  return ((rawScore - baseline) / (maxPerf - baseline)) * 100;
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();

  // Initialize default models
  const defaultModels = DATA.default_models || Object.keys(DATA.models);
  checkedModels = new Set(defaultModels.filter((m) => m in DATA.models));

  populateTaskDropdown();
  checkedTasks = new Set(Object.keys(DATA.metrics_setup));
  bindEventListeners();
  buildCheckboxes();
  buildModelCheckboxes();
  renderChart();
}

// ============================================================
// Dropdown
// ============================================================

function populateTaskDropdown() {
  const select = document.getElementById("task-select");

  // Collect categories
  const categories = {};
  for (const [bench, info] of Object.entries(DATA.metrics_setup)) {
    const cat = info.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(bench);
  }

  // "Aggregate by Category" optgroup
  const catGroup = document.createElement("optgroup");
  catGroup.label = "Aggregate by Category";
  for (const catName of Object.keys(categories).sort()) {
    const opt = document.createElement("option");
    opt.value = "__cat__" + catName;
    opt.textContent = catName;
    catGroup.appendChild(opt);
  }
  select.appendChild(catGroup);

  // "Aggregate by Evaluation Type" optgroup
  const evalTypes = {};
  for (const [bench, info] of Object.entries(DATA.metrics_setup)) {
    const et = info.evaluation_type;
    if (et && !evalTypes[et]) evalTypes[et] = [];
    if (et) evalTypes[et].push(bench);
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

  // "Aggregate by Language" optgroup
  const langGroup = document.createElement("optgroup");
  langGroup.label = "Aggregate by Language";
  const nobOpt = document.createElement("option");
  nobOpt.value = "__lang__nob";
  nobOpt.textContent = "Bokmål";
  langGroup.appendChild(nobOpt);
  const nnoOpt = document.createElement("option");
  nnoOpt.value = "__lang__nno";
  nnoOpt.textContent = "Nynorsk";
  langGroup.appendChild(nnoOpt);
  const smeOpt = document.createElement("option");
  smeOpt.value = "__lang__sme";
  smeOpt.textContent = "Northern Sámi";
  langGroup.appendChild(smeOpt);
  select.appendChild(langGroup);

  // "Individual Tasks" optgroup — all groups + standalone, sorted
  const taskGroup = document.createElement("optgroup");
  taskGroup.label = "Individual Tasks";

  const entries = [];
  for (const groupName of Object.keys(DATA.task_groups)) {
    entries.push({ value: "__group__" + groupName, label: groupName });
  }
  for (const bench of DATA.standalone_benchmarks) {
    const info = DATA.metrics_setup[bench];
    if (!info) continue;
    entries.push({ value: bench, label: info.pretty_name });
  }
  entries.sort((a, b) => a.label.localeCompare(b.label));

  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.value;
    opt.textContent = entry.label;
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

  document.getElementById("task-select").addEventListener("change", (e) => {
    currentTaskSelection = e.target.value;
    const benchmarks = getBenchmarksForSelection(currentTaskSelection);
    if (benchmarks.length > 0) {
      checkedTasks = new Set(benchmarks);
    }
    syncCheckboxStates();
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
}

// ============================================================
// Selection helpers
// ============================================================

function isAggregateSelection(sel) {
  return (
    sel === "__all__" ||
    sel.startsWith("__cat__") ||
    sel.startsWith("__lang__") ||
    sel.startsWith("__eval__")
  );
}

function getBenchmarksForSelection(sel) {
  if (sel === "__all__") {
    return Object.keys(DATA.metrics_setup);
  }
  if (sel.startsWith("__cat__")) {
    const catName = sel.slice(7);
    return Object.keys(DATA.metrics_setup).filter(
      (b) => DATA.metrics_setup[b].category === catName
    );
  }
  if (sel.startsWith("__eval__")) {
    const etName = sel.slice(8);
    return Object.keys(DATA.metrics_setup).filter(
      (b) => DATA.metrics_setup[b].evaluation_type === etName
    );
  }
  if (sel === "__lang__nno") {
    // Nynorsk benchmarks + Bokmål↔Nynorsk translation
    const nno = new Set(DATA.nno_benchmarks || []);
    const nobNno = DATA.nob_nno_translation_benchmarks || [];
    for (const b of nobNno) nno.add(b);
    return [...nno];
  }
  if (sel === "__lang__nob") {
    // Everything that's NOT NNO-only, plus Bokmål↔Nynorsk translation
    const nnoOnly = new Set(DATA.nno_benchmarks || []);
    const smeOnly = new Set(DATA.sme_benchmarks || []);
    const nobNno = new Set(DATA.nob_nno_translation_benchmarks || []);
    return Object.keys(DATA.metrics_setup).filter(
      (b) => (!nnoOnly.has(b) && !smeOnly.has(b)) || nobNno.has(b)
    );
  }
  if (sel === "__lang__sme") {
    return DATA.sme_benchmarks || [];
  }
  if (sel.startsWith("__group__")) {
    const groupName = sel.slice(9);
    const group = DATA.task_groups[groupName];
    return group ? group.benchmarks : [];
  }
  if (DATA.metrics_setup[sel]) {
    return [sel];
  }
  return [];
}

// ============================================================
// Task checkboxes
// ============================================================

function getCheckboxDisplayName(bench) {
  const info = DATA.metrics_setup[bench];
  let name = info.pretty_name;

  // Add language tag for disambiguation
  if (bench.endsWith("_nno")) name += " [Nynorsk]";
  else if (bench.endsWith("_nob")) name += " [Bokmål]";
  else if (bench === "norsumm_nno_nob_translation") name += "";
  else if (bench === "norsumm_nob_nno_translation") name += "";
  else if (bench.includes("_sme")) name += "";

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
      if (info.description) {
        label.title = info.description;
      }

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checkedTasks.has(bench);
      checkbox.dataset.bench = bench;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) checkedTasks.add(bench);
        else checkedTasks.delete(bench);
        if (!isAggregateSelection(currentTaskSelection)) {
          currentTaskSelection = "__all__";
          document.getElementById("task-select").value = "__all__";
        }
        renderChart();
      });

      label.appendChild(checkbox);
      const displayName = getCheckboxDisplayName(bench);
      label.appendChild(document.createTextNode(" " + displayName));
      catDiv.appendChild(label);
    }
    grid.appendChild(catDiv);
  }
}

function syncCheckboxStates() {
  document
    .querySelectorAll("#checkbox-grid input[type=checkbox]")
    .forEach((cb) => {
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

  const allModels = Object.keys(DATA.models);
  for (const modelDir of allModels) {
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
    grid.appendChild(label);
  }
}

// ============================================================
// Chart rendering dispatcher
// ============================================================

function renderChart() {
  updateDescription();
  if (currentTab === "comparison") {
    renderComparisonChart();
  } else {
    renderProgressChart();
  }
}

function updateDescription() {
  const descEl = document.getElementById("task-description");
  if (!descEl) return;

  const sel = currentTaskSelection;
  let description = "";

  if (sel.startsWith("__group__")) {
    const groupName = sel.slice(9);
    const group = DATA.task_groups[groupName];
    if (group) {
      const info = DATA.metrics_setup[group.benchmarks[0]];
      if (info && info.description) description = info.description;
    }
  } else if (
    !isAggregateSelection(sel) &&
    DATA.metrics_setup[sel]
  ) {
    const info = DATA.metrics_setup[sel];
    if (info.description) description = info.description;
  }

  descEl.textContent = description;
  descEl.style.display = description ? "block" : "none";
}

// ============================================================
// Model Comparison charts
// ============================================================

function renderComparisonChart() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) {
    renderAggregateBarChart();
  } else if (sel.startsWith("__group__")) {
    renderGroupedBarChart(sel.slice(9));
  } else {
    renderSingleBenchmarkBarChart(sel);
  }
}

function getModelList() {
  return Object.keys(DATA.models).filter((m) => checkedModels.has(m));
}

function getModelLabel(modelDir) {
  return DATA.model_display_names[modelDir] || modelDir;
}

function getPlotlyLayout(overrides) {
  const base = {
    font: { family: "Inter, system-ui, sans-serif", size: 13 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 60, r: 20, t: 50, b: 100 },
    autosize: true,
  };
  return Object.assign(base, overrides);
}

function renderAggregateBarChart() {
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const scores = [];
  const hoverTexts = [];
  const colors = modelNames.map(getModelColor);

  for (const modelDir of modelNames) {
    let sum = 0,
      count = 0;
    for (const bench of checkedTasks) {
      const val = DATA.models[modelDir]?.[bench]?.[currentShot];
      if (val !== undefined) {
        sum += normalizeScore(val, bench);
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    scores.push(avg);
    hoverTexts.push(
      getModelLabel(modelDir) +
        "<br>Avg: " +
        avg.toFixed(1) +
        " (" +
        count +
        " tasks)"
    );
  }

  const trace = {
    x: labels,
    y: scores,
    type: "bar",
    marker: { color: colors, line: { width: 0 } },
    text: scores.map((s) => s.toFixed(1)),
    textposition: "outside",
    hovertext: hoverTexts,
    hoverinfo: "text",
  };

  const selLabel = getAggregateLabel();
  const yMax = computeAggregateYMaxAllShots(DATA.models, checkedTasks);

  const layout = getPlotlyLayout({
    title: { text: selLabel + " — normalized aggregate (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: {
      title: "normalized score",
      range: [0, yMax],
      gridcolor: "#f0f0f0",
      zeroline: false,
    },
    xaxis: { title: "" },
  });

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupedBarChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;

  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);

  // Create two traces (one per benchmark in the pair), each with per-model colors
  const traces = group.benchmarks.map((bench, i) => {
    const values = modelNames.map((m) => {
      const raw = DATA.models[m]?.[bench]?.[currentShot];
      return raw !== null && raw !== undefined ? toDisplayScale(raw, bench) : null;
    });
    const colors = modelNames.map((m) => {
      const base = getModelColor(m);
      return i === 0 ? lightenColor(base, 0.25) : darkenColor(base, 0.2);
    });
    return {
      x: labels,
      y: values,
      name: group.labels[i],
      type: "bar",
      marker: { color: colors, line: { width: 0 } },
      text: values.map((v) => (v !== null ? v.toFixed(1) : "")),
      textposition: "outside",
      hovertemplate:
        "%{x}<br>" + group.labels[i] + ": %{y:.1f}<extra></extra>",
    };
  });

  const yMax = computeRawYMaxAllShots_display(DATA.models, group.benchmarks);

  const layout = getPlotlyLayout({
    title: { text: groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: "score (0–100)", range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
    barmode: "group",
  });

  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
}

function renderSingleBenchmarkBarChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;

  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const colors = modelNames.map(getModelColor);
  const values = modelNames.map((m) => {
    const raw = DATA.models[m]?.[benchmark]?.[currentShot];
    return raw !== null && raw !== undefined ? toDisplayScale(raw, benchmark) : null;
  });

  const yMax = computeRawYMaxAllShots_display(DATA.models, [benchmark]);

  const trace = {
    x: labels,
    y: values,
    type: "bar",
    marker: { color: colors, line: { width: 0 } },
    text: values.map((v) => (v !== null ? v.toFixed(1) : "")),
    textposition: "outside",
    hovertemplate: "%{x}: %{y:.1f}<extra></extra>",
  };

  const layout = getPlotlyLayout({
    title: { text: info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    yaxis: { title: "score (0–100)", range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

// ============================================================
// Training Progress charts
// ============================================================

function renderProgressChart() {
  const sel = currentTaskSelection;
  if (isAggregateSelection(sel)) {
    renderAggregateProgressChart();
  } else if (sel.startsWith("__group__")) {
    renderGroupProgressChart(sel.slice(9));
  } else {
    renderSingleProgressChart(sel);
  }
}

function getSteps() {
  return Object.keys(DATA.progress)
    .map(Number)
    .sort((a, b) => a - b);
}

function renderAggregateProgressChart() {
  const steps = getSteps();
  const scores = steps.map((step) => {
    let sum = 0,
      count = 0;
    for (const bench of checkedTasks) {
      const val = DATA.progress[step]?.[bench]?.[currentShot];
      if (val !== undefined) {
        sum += normalizeScore(val, bench);
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  });

  const trace = {
    x: steps,
    y: scores,
    mode: "lines+markers",
    name: "NorOLMo",
    line: { color: MODEL_COLORS[0], width: 2.5 },
    marker: { size: 5 },
    hovertemplate: "Step %{x}<br>Score: %{y:.1f}<extra></extra>",
  };

  const selLabel = getAggregateLabel();
  const yMax = computeAggregateYMaxAllShots(DATA.progress, checkedTasks);

  const layout = getPlotlyLayout({
    title: { text: "training progress — " + selLabel + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: {
      title: "normalized score",
      range: [0, yMax],
      gridcolor: "#f0f0f0",
      zeroline: false,
    },
  });

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;

  const steps = getSteps();

  const traces = group.benchmarks.map((bench, i) => {
    const ys = steps.map((s) => {
      const raw = DATA.progress[s]?.[bench]?.[currentShot];
      return raw !== null && raw !== undefined ? toDisplayScale(raw, bench) : null;
    });
    return {
      x: steps,
      y: ys,
      mode: "lines+markers",
      name: group.labels[i],
      line: { width: 2.5 },
      marker: { size: 5 },
      hovertemplate:
        group.labels[i] + "<br>Step %{x}: %{y:.1f}<extra></extra>",
    };
  });

  const yMax = computeRawYMaxAllShots_display(DATA.progress, group.benchmarks);

  const layout = getPlotlyLayout({
    title: { text: "training progress — " + groupName + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: "score (0–100)", range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });

  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
}

function renderSingleProgressChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;

  const steps = getSteps();
  const ys = steps.map((s) => {
    const raw = DATA.progress[s]?.[benchmark]?.[currentShot];
    return raw !== null && raw !== undefined ? toDisplayScale(raw, benchmark) : null;
  });

  const yMax = computeRawYMaxAllShots_display(DATA.progress, [benchmark]);

  const trace = {
    x: steps,
    y: ys,
    mode: "lines+markers",
    name: info.pretty_name,
    line: { color: MODEL_COLORS[0], width: 2.5 },
    marker: { size: 5 },
    hovertemplate: "Step %{x}: %{y:.1f}<extra></extra>",
  };

  const layout = getPlotlyLayout({
    title: { text: "training progress — " + info.pretty_name + " (" + currentShot + "-shot)", font: { size: 16 } },
    xaxis: { title: "training step", dtick: 5000, gridcolor: "#f0f0f0" },
    yaxis: { title: "score (0–100)", range: [0, yMax], gridcolor: "#f0f0f0", zeroline: false },
  });

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

// ============================================================
// Helpers
// ============================================================

function computeYMax(values) {
  if (!values.length) return 100;
  const maxVal = Math.max(...values);
  const padding = Math.max(maxVal * 0.15, 2);
  return Math.min(maxVal + padding, 115);
}

const ALL_SHOTS = ["0", "1", "5"];

function computeAggregateYMaxAllShots(dataSource, benchmarks) {
  const allAvgs = [];
  const entities = Object.keys(dataSource);
  for (const shot of ALL_SHOTS) {
    for (const entity of entities) {
      // For model comparison, only consider checked models
      if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
      let sum = 0,
        count = 0;
      for (const bench of benchmarks) {
        const val = dataSource[entity]?.[bench]?.[shot];
        if (val !== undefined) {
          sum += normalizeScore(val, bench);
          count++;
        }
      }
      if (count > 0) allAvgs.push(sum / count);
    }
  }
  return computeYMax(allAvgs);
}

/** Compute stable y-max across all shots, using display scale (0-100) */
function computeRawYMaxAllShots_display(dataSource, benchmarks) {
  const allVals = [];
  for (const entity of Object.keys(dataSource)) {
    if (dataSource === DATA.models && !checkedModels.has(entity)) continue;
    for (const shot of ALL_SHOTS) {
      for (const bench of benchmarks) {
        const val = dataSource[entity]?.[bench]?.[shot];
        if (val !== undefined && val !== null) {
          allVals.push(toDisplayScale(val, bench));
        }
      }
    }
  }
  return computeYMax(allVals);
}

function getAggregateLabel() {
  const sel = currentTaskSelection;
  if (sel === "__all__") return "all tasks";
  if (sel.startsWith("__cat__")) return sel.slice(7);
  if (sel.startsWith("__eval__")) return sel.slice(8) + " tasks";
  if (sel === "__lang__nob") return "Bokmål tasks";
  if (sel === "__lang__nno") return "Nynorsk tasks";
  if (sel === "__lang__sme") return "Northern Sámi tasks";
  return "aggregate";
}

// ============================================================
// Entry point
// ============================================================

document.addEventListener("DOMContentLoaded", init);
