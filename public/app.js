const DATA_STABLE = "data/stable.json";
const DATA_LATEST = "data/latest.json";
const DATA_RELEASES = "data/releases.json";

const els = {
  heroVersion: document.getElementById("hero-version"),
  heroBumped: document.getElementById("hero-bumped"),
  heroTypicalGap: document.getElementById("hero-typical-gap"),
  heroLatest: document.getElementById("hero-latest"),
  historyTbody: document.getElementById("history-tbody"),
  latestVersion: document.getElementById("latest-version"),
  latestCadence: document.getElementById("latest-cadence"),
  lagChart: document.getElementById("lag-chart"),
  chartWrap: document.getElementById("chart-wrap"),
  chartPlaceholder: document.getElementById("chart-placeholder"),
  soakMedian: document.getElementById("soak-median"),
  errorState: document.getElementById("error-state"),
  retryButton: document.getElementById("retry-button"),
  themeToggle: document.getElementById("theme-toggle"),
};

let chartInstance = null;
let lastState = null;

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${path} not array`);
  return data;
}

function showError() {
  els.errorState.hidden = false;
}

function hideError() {
  els.errorState.hidden = true;
}

function daysBetween(aIso, bIso) {
  const ms = new Date(bIso).getTime() - new Date(aIso).getTime();
  return ms / 86400000;
}

function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return null;
  const i = (sortedNums.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sortedNums[lo];
  return sortedNums[lo] + (sortedNums[hi] - sortedNums[lo]) * (i - lo);
}

// The first machine-written entry is whatever was on stable when polling
// began, so its promotion date is unknown (it was promoted on or before the
// first poll). Manual backfills carry their own evidence and are trusted.
function isSeed(stable, i) {
  return i === 0 && stable[0].source !== "manual";
}

// Gaps between consecutive promotions. The gap that starts at the seed entry
// is only a lower bound, so it is left out of the stats.
function computeGapStats(stable) {
  const start = isSeed(stable, 0) ? 2 : 1;
  if (stable.length <= start) return null;
  const gaps = [];
  for (let i = start; i < stable.length; i++) {
    gaps.push(daysBetween(stable[i - 1].first_observed_utc, stable[i].first_observed_utc));
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    q1: Math.round(percentile(sorted, 0.25)),
    q3: Math.round(percentile(sorted, 0.75)),
    median: Math.round(percentile(sorted, 0.5)),
    count: gaps.length,
  };
}

// Parse "a.b.c" into [a, b, c] as integers. Returns null if not in that shape.
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Number of versions actually published to npm after `stableV`, up to and
// including `latestV`. Version numbers skip, so subtracting patch numbers
// overcounts. Returns null when the release list is unavailable.
function releasesBetween(releases, stableV, latestV) {
  const lo = parseSemver(stableV);
  const hi = parseSemver(latestV);
  if (!releases || !lo || !hi) return null;
  let n = 0;
  for (const r of releases) {
    const v = parseSemver(r.version);
    if (v && compareSemver(v, lo) > 0 && compareSemver(v, hi) <= 0) n++;
  }
  return n;
}

// UTC midnight (ms) for the calendar day an ISO timestamp falls on.
function utcDayStart(iso) {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function renderHero(stable, latest, releases) {
  if (stable.length === 0) {
    els.heroVersion.textContent = "—";
    els.heroBumped.textContent = "No data yet";
    els.heroTypicalGap.textContent = "";
    els.heroLatest.textContent = "";
    return;
  }
  const current = stable[stable.length - 1];
  els.heroVersion.textContent = current.version;

  // first_observed_utc is our daily poll's first sighting, so the real
  // promotion happened at most about a day earlier. The npm publish time is
  // NOT a proxy: builds wait on npm for days before being promoted.
  // Count calendar UTC days so this agrees with the date in the table.
  const days = Math.max(0, Math.round((utcDayStart(new Date().toISOString()) - utcDayStart(current.first_observed_utc)) / 86400000));
  const ago = days === 0 ? "today" : `${plural(days, "day")} ago`;
  els.heroBumped.textContent = isSeed(stable, stable.length - 1)
    ? `on stable since at least ${ago}`
    : `promoted ${ago}`;

  const stats = computeGapStats(stable);
  if (!stats) {
    els.heroTypicalGap.textContent = "not enough history yet";
  } else {
    els.heroTypicalGap.textContent = `typical gap: ${stats.q1}d–${stats.q3}d (median ${stats.median}d, n=${stats.count})`;
  }

  const currentLatest = latest[latest.length - 1];
  if (!currentLatest) {
    els.heroLatest.textContent = "";
    return;
  }
  const dist = releasesBetween(releases, current.version, currentLatest.version);
  if (dist === null) {
    els.heroLatest.textContent = `latest: ${currentLatest.version}`;
  } else if (dist <= 0) {
    els.heroLatest.textContent = `latest: ${currentLatest.version} (caught up)`;
  } else {
    els.heroLatest.textContent = `latest: ${currentLatest.version} (${plural(dist, "release")} ahead)`;
  }
}

function fmtDateUTC(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function lifespanDays(thisIso, nextIso) {
  return Math.max(0, Math.round(daysBetween(thisIso, nextIso)));
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function renderHistory(stable) {
  if (stable.length === 0) {
    els.historyTbody.innerHTML =
      '<tr class="empty-row"><td colspan="4">No promotions recorded yet. Check back after the first poll.</td></tr>';
    return;
  }
  const rows = [];
  for (let i = stable.length - 1; i >= 0; i--) {
    const entry = stable[i];
    const next = stable[i + 1];
    const isCurrent = i === stable.length - 1;
    const seed = isSeed(stable, i);
    const span = isCurrent ? null : lifespanDays(entry.first_observed_utc, next.first_observed_utc);
    const lifespan = isCurrent ? "current" : seed ? `${span}+ d` : `${span} d`;
    const promoted = seed
      ? `on or before ${fmtDateUTC(entry.first_observed_utc)}`
      : fmtDateUTC(entry.first_observed_utc);
    rows.push(
      `<tr class="${isCurrent ? "current" : ""}"${seed ? ' title="Already on stable when tracking began"' : ""}>` +
        `<td>${escapeHtml(entry.version)}</td>` +
        `<td>${promoted}</td>` +
        `<td>${lifespan}</td>` +
        `<td><a href="${escapeAttr(safeUrl(entry.changelog_url))}" rel="noopener noreferrer" target="_blank">view</a></td>` +
        `</tr>`,
    );
  }
  els.historyTbody.innerHTML = rows.join("");
}

// Cadence comes from npm publish times, not from our observations: a daily
// poll of dist-tags.latest sees at most one new version per day.
function renderLatest(latest, releases) {
  if (latest.length === 0) {
    els.latestVersion.textContent = "—";
    els.latestCadence.textContent = "No data yet.";
    return;
  }
  els.latestVersion.textContent = latest[latest.length - 1].version;

  if (!releases) {
    els.latestCadence.textContent = "";
    return;
  }
  const since = Date.now() - 30 * 86400000;
  const recent = releases.filter((r) => new Date(r.published_at).getTime() >= since).length;
  const perWeek = Math.round((recent / 30) * 7 * 10) / 10;
  els.latestCadence.textContent =
    `Anthropic published ${plural(recent, "build")} to npm in the last 30 days (about ${perWeek} per week).`;
}

// One bar per promotion: days between the version's npm publish and our
// first sighting of it on stable ("soak time"). Whole days only, since we poll
// daily. The seed entry is skipped because its promotion date is unknown.
function buildSoakSeries(stable) {
  const points = [];
  stable.forEach((entry, i) => {
    if (isSeed(stable, i) || !entry.published_to_npm_at) return;
    points.push({
      label: entry.version,
      y: Math.max(0, Math.round(daysBetween(entry.published_to_npm_at, entry.first_observed_utc))),
      published: fmtDateUTC(entry.published_to_npm_at),
      observed: fmtDateUTC(entry.first_observed_utc),
    });
  });
  return points;
}

function readCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderChart(stable, latest) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded");
    return;
  }
  const points = buildSoakSeries(stable);
  if (chartInstance) chartInstance.destroy();

  // A single observation can't show change-over-time. Hide chart and
  // explain instead — one dot at lag=0 looks broken to first-time visitors.
  if (points.length < 2) {
    els.chartWrap.hidden = true;
    els.chartPlaceholder.hidden = false;
    chartInstance = null;
    return;
  }
  els.chartWrap.hidden = false;
  els.chartPlaceholder.hidden = true;

  const median = Math.round(percentile(points.map((p) => p.y).sort((a, b) => a - b), 0.5));
  els.soakMedian.textContent = plural(median, "day");
  // Builds promoted in under half the usual wait were fast-tracked (hotfixes).
  const isFast = (p) => p.y < median / 2;

  const accent = readCssVar("--color-accent") || "#d97757";
  const muted = readCssVar("--color-fg-muted") || "#6b6962";
  const line = readCssVar("--color-line") || "#e8e6dc";

  chartInstance = new Chart(els.lagChart, {
    type: "bar",
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: "Days from npm publish to stable",
          data: points.map((p) => p.y),
          backgroundColor: points.map((p) => (isFast(p) ? accent : accent + "8c")),
          borderRadius: 3,
          // Same-day promotions round to 0; keep them visible.
          minBarLength: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => points[items[0].dataIndex].label,
            label: (item) => {
              const p = points[item.dataIndex];
              const tag = isFast(p) ? " (fast-tracked)" : "";
              // Short lines so the tooltip fits on phone screens.
              return [`${plural(p.y, "day")}${tag}`, `published ${p.published}`, `stable ${p.observed}`];
            },
          },
        },
      },
      scales: {
        x: {
          type: "category",
          grid: { display: false },
          ticks: { color: muted, maxRotation: 60, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: line },
          ticks: { color: muted, precision: 0 },
          title: { display: true, text: "days", color: muted },
        },
      },
    },
  });
}

function render(state) {
  lastState = state;
  renderHero(state.stable, state.latest, state.releases);
  renderHistory(state.stable);
  renderLatest(state.latest, state.releases);
  renderChart(state.stable, state.latest);
}

async function load() {
  hideError();
  try {
    const [stable, latest, releases] = await Promise.all([
      fetchJson(DATA_STABLE),
      fetchJson(DATA_LATEST),
      // Optional: the page still renders without it, minus release counts.
      fetchJson(DATA_RELEASES).catch(() => null),
    ]);
    render({ stable, latest, releases });
  } catch (err) {
    console.error("load failed", err);
    showError();
  }
}

els.retryButton.addEventListener("click", load);

load();

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

// The icon shows the current theme; the label names the action, so the
// button is unambiguous for mouse and screen-reader users alike.
function syncThemeLabel() {
  const label = `Switch to ${getTheme() === "dark" ? "light" : "dark"} theme`;
  els.themeToggle.setAttribute("aria-label", label);
  els.themeToggle.setAttribute("title", label);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  syncThemeLabel();
  try {
    localStorage.setItem("ccsw-theme", theme);
  } catch (e) {}
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
    if (lastState) renderChart(lastState.stable, lastState.latest);
    else load();
  }
}

els.themeToggle.addEventListener("click", () => {
  setTheme(getTheme() === "dark" ? "light" : "dark");
});

syncThemeLabel();
