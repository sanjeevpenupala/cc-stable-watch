# cc-stable-watch

Unofficial community tracker for the Claude Code CLI **stable** release
channel. Answers: what's the current stable version, when did it get promoted,
and roughly how often does Anthropic promote a new one?

Live site: <https://sanjeevpenupala.github.io/cc-stable-watch/>

## How it works

A daily GitHub Actions cron polls
[`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code)
on the npm registry, reads `dist-tags.stable` and `dist-tags.latest`, and
appends a new entry to `data/stable.json` / `data/latest.json` when a version
changes. The static frontend in `public/` reads those JSON files at runtime
and renders the page.

The site is hosted on GitHub Pages directly from this repo. Zero build step.

## Honesty about timestamps

There is no public record of when Anthropic flips the `dist-tags.stable`
pointer. We record:

- `published_to_npm_at` — the version's npm publish time (lower bound).
- `first_observed_utc` — the timestamp of our poll that first saw the new
  version on `stable`. The actual promotion happened at most 24 hours before
  this. No "next bump" prediction is made.

## Contributing historical entries

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Disclaimer

Not affiliated with Anthropic. Data sourced from the public npm registry.

## License

Code: MIT (see [LICENSE](./LICENSE)). Data files in `data/` are released into
the public domain (CC0).
