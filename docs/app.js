// NorEval Benchmark Visualization
// ================================

let DATA = null;
let currentTab = "comparison";
let currentShot = "5";
let currentTaskSelection = "__all__";
let checkedTasks = new Set();

const MODEL_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
];

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
};

// ============================================================
// Initialization
// ============================================================

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();

  populateTaskDropdown();
  checkedTasks = new Set(Object.keys(DATA.metrics_setup));
  bindEventListeners();
  buildCheckboxes();
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

  // "Aggregate by Language" optgroup
  const langGroup = document.createElement("optgroup");
  langGroup.label = "Aggregate by Language";
  const nobOpt = document.createElement("option");
  nobOpt.value = "__lang__nob";
  nobOpt.textContent = "Bokm\u00e5l";
  langGroup.appendChild(nobOpt);
  const nnoOpt = document.createElement("option");
  nnoOpt.value = "__lang__nno";
  nnoOpt.textContent = "Nynorsk";
  langGroup.appendChild(nnoOpt);
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
    // Always pre-check the relevant benchmarks
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
    sel.startsWith("__lang__")
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
  if (sel === "__lang__nno") {
    return DATA.nno_benchmarks || [];
  }
  if (sel === "__lang__nob") {
    const nno = new Set(DATA.nno_benchmarks || []);
    return Object.keys(DATA.metrics_setup).filter((b) => !nno.has(b));
  }
  // Individual task group
  if (sel.startsWith("__group__")) {
    const groupName = sel.slice(9);
    const group = DATA.task_groups[groupName];
    return group ? group.benchmarks : [];
  }
  // Standalone benchmark
  if (DATA.metrics_setup[sel]) {
    return [sel];
  }
  return [];
}

// ============================================================
// Checkboxes — always visible, all 34 benchmarks
// ============================================================

function buildCheckboxes() {
  const grid = document.getElementById("checkbox-grid");
  grid.innerHTML = "";

  // Group all benchmarks by category
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

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checkedTasks.has(bench);
      checkbox.dataset.bench = bench;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) checkedTasks.add(bench);
        else checkedTasks.delete(bench);
        // If on an individual task view, switch to aggregate mode
        if (!isAggregateSelection(currentTaskSelection)) {
          currentTaskSelection = "__all__";
          document.getElementById("task-select").value = "__all__";
        }
        renderChart();
      });

      label.appendChild(checkbox);
      // Show benchmark key suffix for disambiguation (e.g. "commonsense QA (acc) [nno]")
      let displayName = info.pretty_name + " (" + info.main_metric + ")";
      if (bench.endsWith("_nno")) displayName += " [NNO]";
      else if (bench.endsWith("_nob")) displayName += " [NOB]";
      else if (bench.includes("_nno_")) displayName += " [NNO\u2192NOB]";
      else if (bench.includes("_nob_") && bench.includes("translation"))
        displayName += " [NOB\u2192NNO]";
      else if (bench.startsWith("tatoeba_eng_nob")) displayName += " [ENG\u2192NOB]";
      else if (bench.startsWith("tatoeba_nob_eng")) displayName += " [NOB\u2192ENG]";
      else if (bench.startsWith("tatoeba_eng_nno")) displayName += " [ENG\u2192NNO]";
      else if (bench.startsWith("tatoeba_nno_eng")) displayName += " [NNO\u2192ENG]";
      else if (bench.startsWith("tatoeba_nob_sme")) displayName += " [NOB\u2192SME]";
      else if (bench.startsWith("tatoeba_sme_nob")) displayName += " [SME\u2192NOB]";

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
// Normalization
// ============================================================

function normalizeScore(rawScore, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  const baseline = info.random_baseline;
  const maxPerf = info.max_performance;
  if (maxPerf === baseline) return 0;
  return ((rawScore - baseline) / (maxPerf - baseline)) * 100;
}

// ============================================================
// Chart rendering dispatcher
// ============================================================

function renderChart() {
  if (currentTab === "comparison") {
    renderComparisonChart();
  } else {
    renderProgressChart();
  }
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
  return Object.keys(DATA.models);
}

function getModelLabel(modelDir) {
  return DATA.model_display_names[modelDir] || modelDir;
}

function renderAggregateBarChart() {
  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const scores = [];
  const hoverTexts = [];

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
    marker: { color: MODEL_COLORS.slice(0, labels.length) },
    text: scores.map((s) => s.toFixed(1)),
    textposition: "outside",
    hovertext: hoverTexts,
    hoverinfo: "text",
  };

  const selLabel = getAggregateLabel();
  const yMax = computeAggregateYMaxAllShots(DATA.models, checkedTasks);

  const layout = {
    title: selLabel + " \u2014 Normalized Aggregate (" + currentShot + "-shot)",
    yaxis: {
      title: "Normalized Score",
      range: [0, yMax],
    },
    xaxis: { title: "" },
    margin: { b: 120, t: 60 },
  };

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupedBarChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;

  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);

  const traces = group.benchmarks.map((bench, i) => {
    const values = modelNames.map(
      (m) => DATA.models[m]?.[bench]?.[currentShot] ?? null
    );
    return {
      x: labels,
      y: values,
      name: group.labels[i],
      type: "bar",
      text: values.map((v) => (v !== null ? formatScore(v, bench) : "")),
      textposition: "outside",
      hovertemplate:
        "%{x}<br>" + group.labels[i] + ": %{y}<extra></extra>",
    };
  });

  const info = DATA.metrics_setup[group.benchmarks[0]];
  const yMax = computeRawYMaxAllShots(DATA.models, group.benchmarks);

  const layout = {
    title:
      groupName + " (" + currentShot + "-shot, " + info.main_metric + ")",
    yaxis: { title: info.main_metric, range: [0, yMax] },
    barmode: "group",
    margin: { b: 120, t: 60 },
  };

  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
}

function renderSingleBenchmarkBarChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;

  const modelNames = getModelList();
  const labels = modelNames.map(getModelLabel);
  const values = modelNames.map(
    (m) => DATA.models[m]?.[benchmark]?.[currentShot] ?? null
  );

  const yMax = computeRawYMaxAllShots(DATA.models, [benchmark]);

  const trace = {
    x: labels,
    y: values,
    type: "bar",
    marker: { color: MODEL_COLORS.slice(0, labels.length) },
    text: values.map((v) => (v !== null ? formatScore(v, benchmark) : "")),
    textposition: "outside",
    hovertemplate: "%{x}: %{y}<extra></extra>",
  };

  const layout = {
    title:
      info.pretty_name +
      " (" +
      currentShot +
      "-shot, " +
      info.main_metric +
      ")",
    yaxis: { title: info.main_metric, range: [0, yMax] },
    margin: { b: 120, t: 60 },
  };

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
    line: { color: MODEL_COLORS[0], width: 2 },
    marker: { size: 5 },
    hovertemplate: "Step %{x}<br>Score: %{y:.1f}<extra></extra>",
  };

  const selLabel = getAggregateLabel();
  const yMax = computeAggregateYMaxAllShots(DATA.progress, checkedTasks);

  const layout = {
    title:
      "Training Progress \u2014 " + selLabel + " (" + currentShot + "-shot)",
    xaxis: { title: "Training Step", dtick: 5000 },
    yaxis: {
      title: "Normalized Score",
      range: [0, yMax],
    },
    margin: { t: 60 },
  };

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;

  const steps = getSteps();

  const traces = group.benchmarks.map((bench, i) => {
    const ys = steps.map(
      (s) => DATA.progress[s]?.[bench]?.[currentShot] ?? null
    );
    return {
      x: steps,
      y: ys,
      mode: "lines+markers",
      name: group.labels[i],
      line: { width: 2 },
      marker: { size: 5 },
      hovertemplate:
        group.labels[i] + "<br>Step %{x}: %{y}<extra></extra>",
    };
  });

  const info = DATA.metrics_setup[group.benchmarks[0]];
  const yMax = computeRawYMaxAllShots(DATA.progress, group.benchmarks);

  const layout = {
    title:
      "Training Progress \u2014 " +
      groupName +
      " (" +
      currentShot +
      "-shot, " +
      info.main_metric +
      ")",
    xaxis: { title: "Training Step", dtick: 5000 },
    yaxis: { title: info.main_metric, range: [0, yMax] },
    margin: { t: 60 },
  };

  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
}

function renderSingleProgressChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;

  const steps = getSteps();
  const ys = steps.map(
    (s) => DATA.progress[s]?.[benchmark]?.[currentShot] ?? null
  );

  const yMax = computeRawYMaxAllShots(DATA.progress, [benchmark]);

  const trace = {
    x: steps,
    y: ys,
    mode: "lines+markers",
    name: info.pretty_name,
    line: { color: MODEL_COLORS[0], width: 2 },
    marker: { size: 5 },
    hovertemplate: "Step %{x}: %{y}<extra></extra>",
  };

  const layout = {
    title:
      "Training Progress \u2014 " +
      info.pretty_name +
      " (" +
      currentShot +
      "-shot, " +
      info.main_metric +
      ")",
    xaxis: { title: "Training Step", dtick: 5000 },
    yaxis: { title: info.main_metric, range: [0, yMax] },
    margin: { t: 60 },
  };

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

// ============================================================
// Helpers
// ============================================================

function formatScore(value, benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (info.max_performance === 100) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

function computeYMax(values) {
  if (!values.length) return 1;
  const maxVal = Math.max(...values);
  // Add 15% headroom, minimum 0.05 absolute padding
  const padding = Math.max(maxVal * 0.15, 0.05);
  return maxVal + padding;
}

const ALL_SHOTS = ["0", "1", "5"];

// Compute stable y-max across all shot settings for aggregate comparison charts
function computeAggregateYMaxAllShots(dataSource, benchmarks) {
  const allAvgs = [];
  const entities = Object.keys(dataSource);
  for (const shot of ALL_SHOTS) {
    for (const entity of entities) {
      let sum = 0, count = 0;
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

// Compute stable y-max across all shot settings for raw benchmark values
function computeRawYMaxAllShots(dataSource, benchmarks) {
  const allVals = [];
  for (const entity of Object.keys(dataSource)) {
    for (const shot of ALL_SHOTS) {
      for (const bench of benchmarks) {
        const val = dataSource[entity]?.[bench]?.[shot];
        if (val !== undefined && val !== null) allVals.push(val);
      }
    }
  }
  return computeYMax(allVals);
}

function getAggregateLabel() {
  const sel = currentTaskSelection;
  if (sel === "__all__") return "All Tasks";
  if (sel.startsWith("__cat__")) return sel.slice(7);
  if (sel === "__lang__nob") return "Bokm\u00e5l Tasks";
  if (sel === "__lang__nno") return "Nynorsk Tasks";
  return "Aggregate";
}

// ============================================================
// Entry point
// ============================================================

document.addEventListener("DOMContentLoaded", init);
