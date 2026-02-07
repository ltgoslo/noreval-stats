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
  updateCheckboxes();
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

  // Category aggregate options
  const catGroup = document.createElement("optgroup");
  catGroup.label = "By Category";
  for (const catName of Object.keys(categories).sort()) {
    const opt = document.createElement("option");
    opt.value = "__cat__" + catName;
    opt.textContent = catName;
    catGroup.appendChild(opt);
  }
  select.appendChild(catGroup);

  // Individual task groups (paired benchmarks)
  const taskGroup = document.createElement("optgroup");
  taskGroup.label = "Individual Tasks (Paired)";
  const addedBenchmarks = new Set();
  for (const [groupName, group] of Object.entries(DATA.task_groups)) {
    const opt = document.createElement("option");
    opt.value = "__group__" + groupName;
    opt.textContent = groupName;
    taskGroup.appendChild(opt);
    group.benchmarks.forEach((b) => addedBenchmarks.add(b));
  }
  select.appendChild(taskGroup);

  // Standalone benchmarks
  const standaloneGroup = document.createElement("optgroup");
  standaloneGroup.label = "Individual Tasks (Single)";
  for (const bench of DATA.standalone_benchmarks) {
    if (addedBenchmarks.has(bench)) continue;
    const info = DATA.metrics_setup[bench];
    if (!info) continue;
    const opt = document.createElement("option");
    opt.value = bench;
    opt.textContent = info.pretty_name;
    standaloneGroup.appendChild(opt);
    addedBenchmarks.add(bench);
  }
  select.appendChild(standaloneGroup);
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
    updateCheckboxes();
    renderChart();
  });

  document.getElementById("select-all-btn").addEventListener("click", () => {
    const benchmarks = getActiveBenchmarks();
    checkedTasks = new Set(benchmarks);
    updateCheckboxStates();
    renderChart();
  });

  document.getElementById("select-none-btn").addEventListener("click", () => {
    checkedTasks.clear();
    updateCheckboxStates();
    renderChart();
  });
}

// ============================================================
// Checkbox management
// ============================================================

function getActiveBenchmarks() {
  if (currentTaskSelection === "__all__") {
    return Object.keys(DATA.metrics_setup);
  }
  if (currentTaskSelection.startsWith("__cat__")) {
    const catName = currentTaskSelection.slice(7);
    return Object.keys(DATA.metrics_setup).filter(
      (b) => DATA.metrics_setup[b].category === catName
    );
  }
  return [];
}

function updateCheckboxes() {
  const container = document.getElementById("task-checkboxes");
  const grid = document.getElementById("checkbox-grid");
  const isAggregate =
    currentTaskSelection === "__all__" ||
    currentTaskSelection.startsWith("__cat__");

  container.style.display = isAggregate ? "block" : "none";
  if (!isAggregate) return;

  const benchmarks = getActiveBenchmarks();
  checkedTasks = new Set(benchmarks);

  // Group by category
  const grouped = {};
  for (const bench of benchmarks) {
    const cat = DATA.metrics_setup[bench].category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(bench);
  }

  grid.innerHTML = "";
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
      checkbox.checked = true;
      checkbox.dataset.bench = bench;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) checkedTasks.add(bench);
        else checkedTasks.delete(bench);
        renderChart();
      });

      label.appendChild(checkbox);
      label.appendChild(
        document.createTextNode(
          " " + info.pretty_name + " (" + info.main_metric + ")"
        )
      );
      catDiv.appendChild(label);
    }
    grid.appendChild(catDiv);
  }
}

function updateCheckboxStates() {
  document.querySelectorAll("#checkbox-grid input[type=checkbox]").forEach((cb) => {
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
  if (sel === "__all__" || sel.startsWith("__cat__")) {
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
    const details = [];
    for (const bench of checkedTasks) {
      const val = DATA.models[modelDir]?.[bench]?.[currentShot];
      if (val !== undefined) {
        const norm = normalizeScore(val, bench);
        sum += norm;
        count++;
        details.push(DATA.metrics_setup[bench].pretty_name + ": " + norm.toFixed(1));
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

  const selLabel =
    currentTaskSelection === "__all__"
      ? "All Tasks"
      : currentTaskSelection.slice(7);

  const layout = {
    title: selLabel + " \u2014 Normalized Aggregate (" + currentShot + "-shot)",
    yaxis: {
      title: "Normalized Score",
      range: [0, Math.max(105, ...scores.map((s) => s + 5))],
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
    const info = DATA.metrics_setup[bench];
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
  const layout = {
    title:
      groupName +
      " (" +
      currentShot +
      "-shot, " +
      info.main_metric +
      ")",
    yaxis: { title: info.main_metric },
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
    yaxis: { title: info.main_metric },
    margin: { b: 120, t: 60 },
  };

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

// ============================================================
// Training Progress charts
// ============================================================

function renderProgressChart() {
  const sel = currentTaskSelection;
  if (sel === "__all__" || sel.startsWith("__cat__")) {
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

  const selLabel =
    currentTaskSelection === "__all__"
      ? "All Tasks"
      : currentTaskSelection.slice(7);

  const layout = {
    title:
      "Training Progress \u2014 " +
      selLabel +
      " (" +
      currentShot +
      "-shot)",
    xaxis: { title: "Training Step", dtick: 5000 },
    yaxis: {
      title: "Normalized Score",
      range: [0, 100],
    },
    margin: { t: 60 },
  };

  Plotly.newPlot("chart", [trace], layout, PLOTLY_CONFIG);
}

function renderGroupProgressChart(groupName) {
  const group = DATA.task_groups[groupName];
  if (!group) return;

  const steps = getSteps();

  const traces = group.benchmarks.map((bench, i) => ({
    x: steps,
    y: steps.map((s) => DATA.progress[s]?.[bench]?.[currentShot] ?? null),
    mode: "lines+markers",
    name: group.labels[i],
    line: { width: 2 },
    marker: { size: 5 },
    hovertemplate:
      group.labels[i] + "<br>Step %{x}: %{y}<extra></extra>",
  }));

  const info = DATA.metrics_setup[group.benchmarks[0]];
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
    yaxis: { title: info.main_metric },
    margin: { t: 60 },
  };

  Plotly.newPlot("chart", traces, layout, PLOTLY_CONFIG);
}

function renderSingleProgressChart(benchmark) {
  const info = DATA.metrics_setup[benchmark];
  if (!info) return;

  const steps = getSteps();
  const trace = {
    x: steps,
    y: steps.map(
      (s) => DATA.progress[s]?.[benchmark]?.[currentShot] ?? null
    ),
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
    yaxis: { title: info.main_metric },
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

// ============================================================
// Entry point
// ============================================================

document.addEventListener("DOMContentLoaded", init);
