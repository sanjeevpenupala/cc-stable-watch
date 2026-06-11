#!/usr/bin/env node
// Poller for @anthropic-ai/claude-code dist-tags.
// Zero dependencies — relies on Node 20+ built-in fetch.

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const PACKAGE = "@anthropic-ai/claude-code";
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE).replace("%40", "@")}`;
const STABLE_PATH = "data/stable.json";
const LATEST_PATH = "data/latest.json";
const KEEPALIVE_PATH = "data/.keepalive";

const DRY_RUN = argv.includes("--dry-run");

function readJsonArray(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON array, got ${typeof parsed}`);
  }
  return parsed;
}

function buildEntry(channel, version, publishedAt) {
  return {
    channel,
    version,
    published_to_npm_at: publishedAt ?? null,
    first_observed_utc: new Date().toISOString(),
    source: "npm-registry",
    changelog_url: `https://github.com/anthropics/claude-code/releases/tag/v${version}`,
    notes: null,
  };
}

async function fetchRegistry() {
  const res = await fetch(REGISTRY_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function diffAndAppend(history, channel, currentVersion, publishedAt) {
  const last = history[history.length - 1];
  if (last && last.version === currentVersion) {
    return { changed: false, entry: null };
  }
  const entry = buildEntry(channel, currentVersion, publishedAt);
  return { changed: true, entry };
}

function writeKeepalive() {
  writeFileSync(KEEPALIVE_PATH, new Date().toISOString() + "\n");
}

async function main() {
  const meta = await fetchRegistry();
  const tags = meta["dist-tags"] ?? {};
  const currentStable = tags.stable;
  const currentLatest = tags.latest;

  if (!currentStable || !currentLatest) {
    throw new Error(
      `Missing dist-tags. stable=${currentStable} latest=${currentLatest}`,
    );
  }

  const stableHistory = readJsonArray(STABLE_PATH);
  const latestHistory = readJsonArray(LATEST_PATH);

  const stableDiff = diffAndAppend(
    stableHistory,
    "stable",
    currentStable,
    meta.time?.[currentStable] ?? null,
  );
  const latestDiff = diffAndAppend(
    latestHistory,
    "latest",
    currentLatest,
    meta.time?.[currentLatest] ?? null,
  );

  const summary = {
    stable: { current: currentStable, changed: stableDiff.changed },
    latest: { current: currentLatest, changed: latestDiff.changed },
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));
    if (stableDiff.entry) console.log("Would append to stable:", stableDiff.entry);
    if (latestDiff.entry) console.log("Would append to latest:", latestDiff.entry);
    return;
  }

  if (stableDiff.changed) {
    stableHistory.push(stableDiff.entry);
    writeFileSync(STABLE_PATH, JSON.stringify(stableHistory, null, 2) + "\n");
  }
  if (latestDiff.changed) {
    latestHistory.push(latestDiff.entry);
    writeFileSync(LATEST_PATH, JSON.stringify(latestHistory, null, 2) + "\n");
  }

  writeKeepalive();

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("poll.mjs failed:", err.message);
  exit(1);
});
