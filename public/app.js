const DATA_STABLE = "data/stable.json";
const DATA_LATEST = "data/latest.json";

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

function computeGapStats(stable) {
  if (stable.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < stable.length; i++) {
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

// When `first_observed_utc` is more than a day after `published_to_npm_at`,
// we missed the actual stable flip and "bumped N days ago" relative to our
// observation would be misleading. Anchor on npm publish date and flag it.
function bumpAnchor(entry) {
  if (entry.published_to_npm_at) {
    const observed = new Date(entry.first_observed_utc).getTime();
    const published = new Date(entry.published_to_npm_at).getTime();
    if (observed - published > 86400000) {
      return { iso: entry.published_to_npm_at, approx: true };
    }
  }
  return { iso: entry.first_observed_utc, approx: false };
}

// Parse "a.b.c" → [a, b, c] as integers. Returns null if not in that shape.
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Best-effort "patch versions between stable and latest" when major+minor
// match (true for every release of this package so far). Falls back to null
// when majors/minors differ — we can't honestly count across minors without
// fetching the full version list from npm.
function versionDistance(stableV, latestV) {
  const a = parseSemver(stableV);
  const b = parseSemver(latestV);
  if (!a || !b) return null;
  if (a[0] !== b[0] || a[1] !== b[1]) return null;
  return b[2] - a[2];
}

function renderHero(stable, latest) {
  if (stable.length === 0) {
    els.heroVersion.textContent = "—";
    els.heroBumped.textContent = "No data yet";
    els.heroTypicalGap.textContent = "";
    els.heroLatest.textContent = "";
    return;
  }
  const current = stable[stable.length - 1];
  els.heroVersion.textContent = current.version;

  const anchor = bumpAnchor(current);
  const days = Math.max(0, Math.floor(daysBetween(anchor.iso, new Date().toISOString())));
  if (anchor.approx) {
    els.heroBumped.textContent =
      days === 0 ? "tracking since today" : `tracking since ${days} day${days === 1 ? "" : "s"} ago`;
  } else {
    els.heroBumped.textContent =
      days === 0 ? "bumped today" : `bumped ${days} day${days === 1 ? "" : "s"} ago`;
  }

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
  const dist = versionDistance(current.version, currentLatest.version);
  if (dist === null) {
    els.heroLatest.textContent = `latest: ${currentLatest.version}`;
  } else if (dist <= 0) {
    els.heroLatest.textContent = `latest: ${currentLatest.version} (caught up)`;
  } else {
    els.heroLatest.textContent = `latest: ${currentLatest.version} (+${dist} version${dist === 1 ? "" : "s"} ahead)`;
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
    const lifespan = isCurrent
      ? "current"
      : `${lifespanDays(entry.first_observed_utc, next.first_observed_utc)} d`;
    rows.push(
      `<tr class="${isCurrent ? "current" : ""}">` +
        `<td>${escapeHtml(entry.version)}</td>` +
        `<td>${fmtDateUTC(entry.first_observed_utc)}</td>` +
        `<td>${lifespan}</td>` +
        `<td><a href="${escapeAttr(safeUrl(entry.changelog_url))}" rel="noopener noreferrer" target="_blank">view</a></td>` +
        `</tr>`,
    );
  }
  els.historyTbody.innerHTML = rows.join("");
}

function renderLatest(latest) {
  if (latest.length === 0) {
    els.latestVersion.textContent = "—";
    els.latestCadence.textContent = "No data yet.";
    return;
  }
  const current = latest[latest.length - 1];
  els.latestVersion.textContent = current.version;

  if (latest.length < 2) {
    els.latestCadence.textContent = "Cadence will appear once more data is collected.";
    return;
  }
  const gaps = [];
  for (let i = 1; i < latest.length; i++) {
    gaps.push(daysBetween(latest[i - 1].first_observed_utc, latest[i].first_observed_utc));
  }
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const rounded = avg < 1 ? Number(avg.toFixed(1)) : Math.round(avg);
  els.latestCadence.textContent = `Anthropic pushes a new build every ${rounded} day${rounded === 1 ? "" : "s"} on average.`;
}

// Assumes `stable` is sorted ascending by first_observed_utc (poller invariant).
function stableVersionAt(stable, iso) {
  let active = null;
  for (const entry of stable) {
    if (new Date(entry.first_observed_utc) <= new Date(iso)) active = entry;
    else break;
  }
  return active;
}

// UTC midnight (ms) for the calendar day an ISO timestamp falls on.
function utcDayStart(iso) {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// "Jun 11" in UTC — labels must match the bucketing so points land on ticks.
function utcDayLabel(dayStartMs) {
  return new Date(dayStartMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// We poll once a day, so sub-day precision is false precision — the exact
// timestamps are cron-firing artifacts, not release signal. Quantize lag to
// whole UTC days and emit one point per UTC day (last observation wins) so the
// chart shows honest daily resolution aligned to the date gridlines.
function buildLagSeries(stable, latest) {
  const byDay = new Map();
  for (const lat of latest) {
    // Fall back to earliest stable when no entry predates this observation:
    // happens at seed time when both channels were captured by the same poll.
    const sta = stableVersionAt(stable, lat.first_observed_utc) ?? stable[0];
    if (!sta) continue;
    const latDay = utcDayStart(lat.first_observed_utc);
    const lagDays = Math.max(0, Math.round((latDay - utcDayStart(sta.first_observed_utc)) / 86400000));
    byDay.set(latDay, { label: utcDayLabel(latDay), y: lagDays });
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, point]) => point);
}

function readCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderChart(stable, latest) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded");
    return;
  }
  const points = buildLagSeries(stable, latest);
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

  const accent = readCssVar("--color-accent") || "#d97757";
  const muted = readCssVar("--color-fg-muted") || "#6b6962";
  const line = readCssVar("--color-line") || "#e8e6dc";

  chartInstance = new Chart(els.lagChart, {
    type: "line",
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: "Days latest is ahead of stable (UTC)",
          data: points.map((p) => p.y),
          borderColor: accent,
          backgroundColor: accent + "33",
          tension: 0.25,
          pointRadius: points.length > 30 ? 0 : 3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: "category",
          grid: { color: line },
          ticks: { color: muted },
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
  renderHero(state.stable, state.latest);
  renderHistory(state.stable);
  renderLatest(state.latest);
  renderChart(state.stable, state.latest);
}

async function load() {
  hideError();
  try {
    const [stable, latest] = await Promise.all([
      fetchJson(DATA_STABLE),
      fetchJson(DATA_LATEST),
    ]);
    render({ stable, latest });
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

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
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
