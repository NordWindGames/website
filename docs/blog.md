# The devlog pipeline

A devlog about Nordwind Games' own development. This document is the whole picture: what the
commands do, what the invariants are, and what is deliberately not automated.

**The one thing to understand:** topics come from **our own git history**. The reference blogs
(Factorio, Yacht Club Games, Stardew Valley, Archmage Rises) are there to learn cadence and format
from — never to mine for post ideas. A devlog about other people's devlogs is the failure mode this
pipeline is shaped to prevent.

## Commands

```bash
npm run blog          # status: what is new, what is approved, what to do next. Never fetches.
npm run blog:scan     # reference blogs + our git activity + our posts -> content/ideas/scan.json
npm run blog:check    # the quality gates. Runs in CI on every PR.
```

Everything with flags runs directly:

```bash
node scripts/blog.mjs scan --probe          # endpoint reachability, writes nothing
node scripts/blog.mjs scan --full           # baseline: refetch all, ignore caches, no extraction
node scripts/blog.mjs scan --extract 40     # read the shape of more new posts (default 20)
node scripts/blog.mjs extract <url>         # one page's shape, as JSON on stdout

node scripts/blog.mjs idea                  # the backlog
node scripts/blog.mjs idea --next           # what blog-write would pick up
node scripts/blog.mjs add                   # append items from JSON on stdin, forced to "new"
node scripts/blog.mjs set approved <id>     # move through the state machine
node scripts/blog.mjs note <id> "..."       # append to an item's follow-up log

node scripts/blog.mjs check --only lint     # one gate at a time, when debugging
node scripts/blog.mjs --help
```

Statuses for a post idea: `new → approved → in_progress → drafted → published`, plus `blocked` and
`rejected`. For a practice: `new → adopted | deferred | rejected`. `set` enforces what each
transition requires — a reason to reject or block, a slug to start, and real files on disk before
`drafted`.

## The weekly routine

1. `npm run blog:scan`
2. `/blog-research` — turns the scan into scored ideas and practice observations
3. Review: `node scripts/blog.mjs idea`, then `set approved <id>` or
   `set rejected <id> --reason "..."`
4. `/blog-write` — writes the top-scored approved idea in EN and DE
5. `npm run blog:check` and `npm run build`, then merge

## Layout

Three layers:

- **Deterministic core** — `scripts/blog.mjs` (the CLI) and `scripts/lib/` (nine single-purpose
  modules). Zero dependencies, Node built-ins only. Fetch, parse, dedupe, check, write.
- **Reasoning layer** — `.claude/skills/blog-research/` and `.claude/skills/blog-write/`. Idea
  generation, scoring, drafting. Run via Claude Code.
- **State** — JSON in `content/ideas/`.

| `scripts/lib/` | does |
| --- | --- |
| `ctx.mjs` | root, config with defaults, paths, JSON and date helpers, argv parsing |
| `posts.mjs` | the single corpus reader: one pass over `src/content/blog/<locale>/*.md` |
| `http.mjs` | conditional GET, one retry, a worker pool with a per-host cap |
| `parse.mjs` | sitemaps, RSS/Atom, HTML listings, article shape |
| `git.mjs` | our own activity, clustered by conventional-commit type |
| `scan.mjs` | one scan: discover, dedupe, extract, inventory — into one snapshot |
| `backlog.mjs` | load/save, the status machine, validation |
| `gates.mjs` | the conventions and image gates |

### State files

| file | committed | what |
| --- | --- | --- |
| `blog.config.json` | yes | paths, locales, conventions, scoring weights. No URLs. |
| `sources.example.json` | yes | schema template with fake URLs |
| `repos.example.json` | yes | schema template with a fake path |
| `sources.local.json` | **no** | the real reference-blog URLs |
| `repos.local.json` | **no** | local paths to other repos (the game repo) |
| `state.json` | no | seen URLs + per-endpoint cache validators. Bookkeeping, not for reading. |
| `scan.json` | no | the one snapshot the reasoning layer reads |
| `backlog.json` | no | ideas and practices, one array with a `kind` |
| `rejected.md` | no | standing no-go areas, written by hand |

This repo is **public**: the reference-blog URLs and anything derived from them must never land in
its history. `.gitignore` allowlists exactly the four committed files above.

Everything generated is reproducible from the sources plus git history, except the dedup waterline
in `state.json`. Losing it means the next scan reports every reference post as new once — an
accepted inconvenience, not data loss.

**New machine:** copy `sources.example.json` → `sources.local.json` and fill in the real sources;
copy `repos.example.json` → `repos.local.json` and point it at the game repo.

## Invariants — do not relitigate without a new reason

- **A silently broken source must never look like a quiet week.** Every source declares an
  `expected_min`; under it is a FAIL with `complete: false` and a non-zero exit.
- **A cached 304 is still checked against `expected_min`,** using the count from the last real
  fetch. Exempting cached sources would be exactly the masking the check exists to prevent. Stored
  validators also expire after `cadence_days`, so a server that answers 304 forever cannot hide a
  change indefinitely.
- **`status` never touches the network.** It is the command you run to orient yourself; it answers
  instantly and offline. Structurally guaranteed: nothing it imports can reach `http.mjs`.
- **`check` keeps going after a failing gate** so one run shows every problem.
- **The human approval gate is never bypassed.** `add` forces `status: "new"` and strips any
  supplied `reviewed_at`. Nothing in this pipeline approves its own output.
- **Derived data is not stored.** `scores.total` is computed from `scoring.weights` on read, so it
  cannot disagree with the axes it comes from. There is no post inventory file to go stale.
- **Never store full article text** from a reference blog. Outline plus counts is enough.
- **Image paths are checked case-exactly.** `existsSync` is case-insensitive on Windows; the deploy
  target is Linux.
- **The four score axes all point the same way** — `interest`, `evidence`, `ease`, `durability`,
  higher always better.

## Gates

`npm run blog:check` runs three, and keeps going after a failure.

**conventions** — frontmatter present and ISO-dated; slug kebab-case; hero image directly under the
frontmatter; no absolute link to our own domain; internal links root-relative with the right locale
prefix; link targets and routes actually exist; no self-links; DE/EN pairing. Also prints inbound
links per slug and the corpus word/H2 distribution.

**images** — path shape, existence, case-exactness, alt text, and a readable `viewBox` on every SVG.

**backlog** — required fields, id format, statuses inside the machine, axes as integers 1–5, and
that a `drafted` or `published` item's slug really has files in both locales. Self-skips when
`backlog.json` is absent, which is the case on a fresh CI checkout.

Route resolution walks `src/pages` recursively and accepts real files under `public/`, so a link to
`/imprint/does-not-exist` fails even when `/imprint` exists.

The DE/EN pairing is enforced **only here.** Astro does not care: an EN-only post builds and deploys
fine, `/de/blog/<slug>/` simply does not exist. Set `locales.require_pairing` to `false` and the
bilingual guarantee is gone with nothing else noticing.

Frontmatter *shape* is owned by the zod `.strict()` schema in `src/content.config.ts` — `title`,
`description`, `date`, and an extra field is a build error. The gates defer to it rather than
re-declaring an allowlist.

## Cold start

`conventions.min_internal_links_ramp` is dormant by design: no floor until 3 posts exist, then 1,
then 2 at 5. There is deliberately no word or H2 band — `blog:check` prints the actual corpus
distribution instead, so the numbers to set a real band are in front of you when it becomes
relevant.

## What is deliberately not automated

There is no scheduler and no reminder hook. Discovery is cheap enough to run whenever; `npm run
blog` tells you where things stand. Approving an idea, deciding a practice, and publishing are all
human acts — `published` is set after the merge, and the merge is a decision, not a step.
