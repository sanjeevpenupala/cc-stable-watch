const DATA_STABLE = "data/stable.json";
const DATA_LATEST = "data/latest.json";
const DATA_RELEASES = "data/releases.json";

const els = {
  heroVersion: document.getElementById("hero-version"),
  heroBumped: document.getElementById("hero-bumped"),
  heroLatest: document.getElementById("hero-latest"),
  historyTbody: document.getElementById("history-tbody"),
  latestVersion: document.getElementById("latest-version"),
  latestCadence: document.getElementById("latest-cadence"),
  historySummary: document.getElementById("history-summary"),
  errorState: document.getElementById("error-state"),
  retryButton: document.getElementById("retry-button"),
  themeToggle: document.getElementById("theme-toggle"),
};

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

// Median and middle half (25th to 75th percentile), rounded to whole days
// because we poll once a day.
function summarize(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    q1: Math.round(percentile(sorted, 0.25)),
    q3: Math.round(percentile(sorted, 0.75)),
    median: Math.round(percentile(sorted, 0.5)),
    count: nums.length,
  };
}

// "Stable for": gaps between consecutive promotions. The gap that starts at
// the seed entry is only a lower bound, so it is left out of the stats.
function computeGapStats(stable) {
  const gaps = [];
  for (let i = isSeed(stable, 0) ? 2 : 1; i < stable.length; i++) {
    gaps.push(daysBetween(stable[i - 1].first_observed_utc, stable[i].first_observed_utc));
  }
  return summarize(gaps);
}

// "Waited": whole days from npm publish to our first sighting on stable.
// Null for the seed entry (promotion date unknown) or a missing publish time.
function waitDays(stable, i) {
  const entry = stable[i];
  if (isSeed(stable, i) || !entry.published_to_npm_at) return null;
  return Math.max(0, Math.round(daysBetween(entry.published_to_npm_at, entry.first_observed_utc)));
}

function computeWaitStats(stable) {
  const waits = stable.map((_, i) => waitDays(stable, i)).filter((w) => w !== null);
  return summarize(waits);
}

// Fast-tracked: waited under half the median wait. Waits cluster tightly
// (about 7 to 12 days) with hotfixes at 0 to 2, so half the median sits in
// the empty stretch between them and moves if the usual wait ever changes.
function isFastTracked(wait, waitStats) {
  return wait !== null && waitStats !== null && wait < waitStats.median / 2;
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

// Whole calendar UTC days from `iso` to today, so "N days ago" agrees with
// the dates shown in the table.
function calendarDaysSince(iso) {
  return Math.max(0, Math.round((utcDayStart(new Date().toISOString()) - utcDayStart(iso)) / 86400000));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function renderHero(stable, latest, releases) {
  if (stable.length === 0) {
    els.heroVersion.textContent = "—";
    els.heroBumped.textContent = "No data yet";
    els.heroLatest.textContent = "";
    return;
  }
  const current = stable[stable.length - 1];
  els.heroVersion.textContent = current.version;

  // first_observed_utc is our daily poll's first sighting, so the real
  // promotion happened at most about a day earlier. The npm publish time is
  // NOT a proxy: builds wait on npm for days before being promoted.
  const days = calendarDaysSince(current.first_observed_utc);
  const ago = days === 0 ? "today" : `${plural(days, "day")} ago`;
  els.heroBumped.textContent = isSeed(stable, stable.length - 1)
    ? `Current stable, already stable when tracking began ${ago}`
    : `Current stable, promoted ${ago}`;

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

// "1-5" kept on one line so it never wraps at the hyphen.
function range(stats) {
  const text = stats.q1 === stats.q3 ? `${stats.q1}` : `${stats.q1}-${stats.q3}`;
  return `<span class="nowrap">${text}</span>`;
}

function renderSummary(stable) {
  const wait = computeWaitStats(stable);
  const gap = computeGapStats(stable);
  if (!wait || !gap) {
    els.historySummary.textContent = "Typical wait and stable times appear once a few promotions are recorded.";
    return;
  }
  els.historySummary.innerHTML =
    `Builds wait a median <strong>${plural(wait.median, "day")}</strong> (usually ${range(wait)}) ` +
    `on npm before promotion, then stay stable a median <strong>${plural(gap.median, "day")}</strong> ` +
    `(usually ${range(gap)}).`;
}

function renderHistory(stable) {
  if (stable.length === 0) {
    els.historyTbody.innerHTML =
      '<tr class="empty-row"><td colspan="6">No promotions recorded yet. Check back after the first poll.</td></tr>';
    return;
  }
  const waitStats = computeWaitStats(stable);
  const rows = [];
  for (let i = stable.length - 1; i >= 0; i--) {
    const entry = stable[i];
    const next = stable[i + 1];
    const isCurrent = i === stable.length - 1;
    const seed = isSeed(stable, i);

    const published = entry.published_to_npm_at ? fmtDateUTC(entry.published_to_npm_at) : "unknown";
    const promoted = seed
      ? `on or before ${fmtDateUTC(entry.first_observed_utc)}`
      : fmtDateUTC(entry.first_observed_utc);

    const wait = waitDays(stable, i);
    let waited = wait === null ? '<span class="muted">unknown</span>' : `${wait}`;
    if (isFastTracked(wait, waitStats)) waited += ' <span class="tag">fast-tracked</span>';

    const span = isCurrent
      ? calendarDaysSince(entry.first_observed_utc)
      : lifespanDays(entry.first_observed_utc, next.first_observed_utc);
    const stableFor = isCurrent ? `${span} so far` : seed ? `${span}+` : `${span}`;

    rows.push(
      `<tr class="${isCurrent ? "current" : ""}"${seed ? ' title="Already on stable when tracking began"' : ""}>` +
        `<th scope="row">${escapeHtml(entry.version)}</th>` +
        `<td>${published}</td>` +
        `<td>${promoted}</td>` +
        `<td>${waited}</td>` +
        `<td>${stableFor}</td>` +
        `<td><a href="${escapeAttr(safeUrl(entry.changelog_url))}" rel="noopener noreferrer" target="_blank" aria-label="Changelog for ${escapeAttr(entry.version)} (opens in a new tab)">view</a></td>` +
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

function render(state) {
  renderHero(state.stable, state.latest, state.releases);
  renderSummary(state.stable);
  renderHistory(state.stable);
  renderLatest(state.latest, state.releases);
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
}

els.themeToggle.addEventListener("click", () => {
  setTheme(getTheme() === "dark" ? "light" : "dark");
});

syncThemeLabel();
