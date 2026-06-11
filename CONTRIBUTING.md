# Contributing to cc-stable-watch

Thanks for considering a contribution. The most valuable contributions are
**historical backfill entries** — proof that a given Claude Code CLI version was
on the `stable` (or `latest`) `dist-tag` at a specific point in time.

## Backfilling a stable promotion

1. Find a piece of evidence with a timestamp:
   - Wayback Machine snapshot of the npm registry page
     (`https://web.archive.org/web/*/registry.npmjs.org/@anthropic-ai/claude-code`).
   - A dated blog post, screenshot, or commit referencing the version on `stable`.
   - The npm registry itself for the version publish time (lower bound only).

2. Open a PR that appends a single object to `data/stable.json`, keeping the
   array sorted oldest-first. Use this exact schema:

   ```json
   {
     "channel": "stable",
     "version": "2.1.5",
     "published_to_npm_at": "2026-01-19T14:00:00Z",
     "first_observed_utc": "2026-01-20T08:30:00Z",
     "source": "manual",
     "changelog_url": "https://github.com/anthropics/claude-code/releases/tag/v2.1.5",
     "notes": "Wayback Machine snapshot 2026-01-20T08:30Z"
   }
   ```

   Required fields:
   - `channel`: `"stable"` or `"latest"`
   - `version`: the exact semver string
   - `first_observed_utc`: ISO-8601 UTC of the **evidence** (not the present)
   - `source`: `"manual"` for human contributions
   - `notes`: required for manual backfills (the source link or short description); machine-written entries leave this as `null`

   Optional:
   - `published_to_npm_at`: ISO-8601 UTC from the npm registry
   - `changelog_url`: derived as `https://github.com/anthropics/claude-code/releases/tag/v{version}`

3. In the PR description, include the source URL(s) and any screenshot evidence.

## Code contributions

The poller (`scripts/poll.mjs`) is deliberately tiny and zero-dependency. Run
`node scripts/poll.mjs --dry-run` before submitting changes.

The frontend (`public/`) is plain HTML/CSS/JS. No build step. Open
`public/index.html` via a local static server and verify both themes.

## License

Code is MIT. Data files (`data/*.json`) are released into the public domain (CC0).
By contributing, you agree to release your changes under the same terms.
