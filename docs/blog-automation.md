# Devlog automation pipeline

A personal-studio devlog idea pipeline, ported from a competitor-monitoring pipeline built for an
SEO-driven agency blog and adapted for this repo's actual purpose: a devlog about Nordwind Games'
own development, not about out-ranking anyone. The genre adaptation is recorded in
`_port/blog-pipeline-port-devlog.md` — read that first if something here seems arbitrary, it
probably explains why. (The origin pipeline's own architecture/porting docs are not kept in this
repo — they carried a different company's real competitor list and business specifics, which do
not belong in a public Nordwind Games repo. This document is the standalone replacement.)

**The one thing to understand:** topics come from `dev-activity.json` (our own git history), not
from the four reference blogs. The reference blogs — Factorio, Yacht Club Games, Stardew Valley,
Archmage Rises — are there to learn cadence and format from, never to mine for post ideas.

**Day-to-day usage** (commands, weekly routine, a diagram of the whole flow): see
[`content/ideas/README.md`](../content/ideas/README.md). This document covers architecture,
invariants and the specifics actually verified for this repo.

## Architecture

Three layers, same split as the origin pipeline:

- **Deterministic core** — `scripts/blog-*.mjs`. Zero dependencies, no LLM calls, no network
  except `blog-sources.mjs`/`blog-extract.mjs` fetching the reference blogs. Fetch, parse, dedupe,
  write files.
- **Reasoning layer** — `.claude/skills/blog-research/SKILL.md` and `.claude/skills/blog-write/SKILL.md`.
  Idea generation, scoring, drafting. Run via Claude Code.
- **State** — JSON/Markdown files in `content/ideas/`. See "Privacy" below for what is and is not
  committed.

Scheduler: `.claude/settings.json`'s `SessionStart` hook runs `node scripts/blog-weekly.mjs --check`
on every session start; it is silent unless the reminder is due and never fails a session start.
There is no CI-based scheduler (no `ANTHROPIC_API_KEY` in this repo, and none is planned).

## Own development: multiple repos

`blog-devlog.mjs` scans this website repo by default, plus every repo listed in
`content/ideas/repos.local.json` (gitignored — see "Privacy" below). In practice the game repo,
not this one, is the actual source of devlog-worthy activity; without `repos.local.json` set up,
`dev-activity.json` only reflects website-repo commits, and the research skill is told to say so
rather than treat that as the full picture.

Each commit is captured with its full message body as `comment` (`git log`'s `%b`, not just the
subject `%s`) — write real explanatory commit bodies in the game repo (what you tried, what didn't
work, why) if you want the research skill to have real material to turn into a `learning` or
`deep-dive` post, not just a changelog line. A path that does not exist on this machine is skipped
with a warning rather than crashing the run.

## Privacy — what is and is not committed

This repo is **public**. The reference-blog URLs, and anything derived from them, must never land
in its git history.

- **Committed**: `content/ideas/blog.config.json` (generic settings, no URLs),
  `content/ideas/sources.example.json` and `content/ideas/repos.example.json` (schema templates,
  fake URLs/paths).
- **Gitignored**: `sources.local.json` (the real 4 URLs), `repos.local.json` (real local paths to
  other repos, e.g. the game repo — machine-specific, not portable, arguably personal), `seen.json`,
  `discovered.json`, `new-urls.json`, `blog-index.json`, `dev-activity.json`, `backlog.json`,
  `practices.json`, `rejected.md`. All of it is regenerable from the reference blogs plus git
  history, except the dedup state in `seen.json` — if `content/ideas/` is ever lost, the next
  `--delta` run will re-report every reference-blog post as new. That is an accepted, one-time
  inconvenience, not a data-loss risk: `--delta` still runs correctly, it just briefly looks like
  a busy period.
- **Consequence for CI**: `.github/workflows/ci.yml` runs `npm run blog:check` on every PR, but
  `backlog.json` does not exist on a fresh checkout. `blog-check.mjs` skips that one gate with a
  `SKIP` note instead of failing; the other three gates (inventory, conventions, images) still run
  against every post actually checked in.

To set this up on a new machine: copy `content/ideas/sources.example.json` to
`content/ideas/sources.local.json` and fill in the real sources (the reference-blog list is not
reproduced here for the same reason it is not committed), and copy
`content/ideas/repos.example.json` to `content/ideas/repos.local.json` pointing at the game repo's
local checkout.

## The four reference sources, as actually verified (2026-08-24)

| Source | Discovery | Verified count | Notes |
| --- | --- | --- | --- |
| Factorio (Friday Facts) | Atom feed, `/blog/rss` | 10 (truncated) | No sitemap. HTML listing also paginated at 10/page — not scraped, a shallow recent view is enough for a format reference. |
| Yacht Club Games | HTML listing, `/blog/` | 25 unique posts | Nuxt.js SPA, server-rendered. No feed or sitemap found anywhere (`?format=rss`, common feed paths, `sitemap.xml` all failed). Fragile by construction — watch for FAIL if it ever moves to client-side pagination. |
| Stardew Valley | WordPress RSS, `/blog/feed/` | 10 (truncated) | Blog-category-scoped feed (confirmed by title). No sitemap. Post URLs are flat root-level slugs, not `/YYYY/MM/...` — this was wrong on the first pass and had to be corrected after an actual `--baseline` run surfaced the real path shapes. |
| Archmage Rises | Squarespace RSS, `/news?format=rss` (delta) + `sitemap.xml` (baseline) | 20 (feed) / 282 (sitemap) | The only one of the four with a real sitemap; used only for `--baseline` via `baseline_endpoint`, since it goes far deeper than the feed. |

Extraction failures hit during setup: none of the four required `WebSearch` fallback or a
`--probe` correction beyond the Stardew Valley `pathFilter` above — all four were reachable via
plain `fetch` with the default UA on the first `--probe`.

## The pipeline's own invariants (do not relitigate without a new reason)

- **`blog-sources.mjs` exits 2** when a source comes in under `expected_min`, still writes its
  artefacts, and records `complete: false`. A silently broken source must look different from a
  quiet period.
- **`lastRun()` in `blog-weekly.mjs` ignores incomplete runs** — a half-failed discovery does not
  reset the `cadence_days` clock.
- **`blog-check.mjs` keeps going after a failing gate** so one run shows every problem.
- **`blog-backlog.mjs --validate` recomputes every `scores.total` from `scoring.formula`** in
  `backlog.json` — that string is the only place the weighting lives.
- **`blog-assets.mjs` checks paths case-exactly** (Windows/macOS `existsSync` is case-insensitive;
  the GitHub Pages deploy target is Linux).
- **The four score axes all point the same way** — `interest`, `evidence`, `ease`, `durability`,
  higher always better. See `_port/blog-pipeline-port-devlog.md` section 2.5 for why.
- **The human approval gate is never bypassed.** Every idea and every practice observation starts
  at `status: "new"`. Nothing in this pipeline approves its own output.

## Idea types and scoring

Five idea types (`progress`, `deep-dive`, `learning`, `milestone`, `refresh`) and four scoring axes
(`interest`, `evidence`, `ease`, `durability`) — replacing the origin's SEO-shaped
`coverage-gap`/`angle-gap`/`ranking-gap`/`refresh` and `demand`/`fit`/`ease`/`distinctness`. Full
rationale in `_port/blog-pipeline-port-devlog.md` sections 2.4–2.5.

## Cold start

This devlog has zero posts as of this writing. `content/ideas/blog.config.json`'s
`conventions.min_internal_links` is `0` and ramps to `1` at 3 posts, `2` at 5 posts
(`min_internal_links_ramp`). Word/H2 count bands are left wide open (no corpus to derive real
numbers from) and should be recalibrated once 5 posts exist. `legacy_slugs` is empty and must stay
that way unless a specific post genuinely predates this pipeline.

## Commands

```bash
npm run blog:weekly    # discovery + own inventory + dev-activity + briefing
npm run blog:check     # all four gates (inventory, conventions, images, backlog)
npm run blog:lint      # conventions gate only
npm run blog:assets    # image gate only
npm run blog:dev       # regenerate dev-activity.json on its own

node scripts/blog-sources.mjs --probe      # reachability check, writes nothing
node scripts/blog-backlog.mjs              # review the backlog
node scripts/blog-backlog.mjs --next       # what blog-write would pick up
```

## Publishing cadence

Weekly, by the user's own decision — enforced as a hard rule in `.claude/skills/blog-write/SKILL.md`,
not just a suggestion. This is separate from `cadence_days` (30, monthly), which only paces the
*reminder* to re-run reference-blog research — discovery itself is cheap enough to run any time.
