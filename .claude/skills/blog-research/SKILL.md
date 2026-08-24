---
name: blog-research
description: Periodic devlog idea generation. Reads our own git history plus the reference blogs, generates scored post ideas and practice observations, and appends them to content/ideas/backlog.json and content/ideas/practices.json. Use when asked to find new devlog ideas, run the devlog research, or refresh the backlog.
---

# Devlog idea generation

Reads alongside `docs/blog-automation.md` (how the pipeline works, why the human gate is not
optional, why deterministic and reasoning work are split) and `_port/blog-pipeline-port-devlog.md`
(why this is a devlog, not an SEO blog, and what changed because of that).

The failure mode this procedure exists to prevent: **a devlog about other people's devlogs.** The
reference blogs — Factorio, Yacht Club Games, Stardew Valley, Archmage Rises — teach *how* to write
a devlog. They are not a topic supply. Topics come from `dev-activity.json`, our own development.
Read section 1 of `_port/blog-pipeline-port-devlog.md` before running this the first time.

---

## 1. Discover (deterministic, no tokens)

```bash
node scripts/blog-devlog.mjs              # our own activity since the last published post
node scripts/blog-sources.mjs --delta     # new reference-blog posts since last run
node scripts/blog-index.mjs               # refresh our own inventory
```

`blog-devlog.mjs` scans this website repo plus every repo listed in
`content/ideas/repos.local.json` (gitignored — a local absolute path is machine-specific). The
game repo is the one that actually matters for a devlog; if `dev-activity.json` only shows a
`website` entry, `repos.local.json` is not set up yet — say so in the report rather than treating
website-only activity as the whole picture.

Read the OK/FAIL report from `blog-sources.mjs`. **A `FAIL` means a reference blog changed its site
structure, not that the threshold is wrong.** Inspect and fix `content/ideas/sources.local.json`
(gitignored — the real URLs live only there); never quietly lower `expected_min`. To retire a source
on purpose, set `"enabled": false` on it.

**Exit code 2 means a source came in short.** The artefacts are still written but the corpus is
incomplete (`complete: false`, `sources_failed`). Say so at the top of your report and be more
cautious about pattern claims from that source this run.

An empty delta from the reference blogs is a completely normal outcome — several of them publish
rarely. `dev-activity.json` being thin is the actually informative signal: it means development was
slow, and that is itself something a devlog can honestly say (devlog doc section 2.6).

## 2. Extract (only for genuinely new reference posts, if any)

```bash
node scripts/blog-extract.mjs --from content/ideas/new-urls.json > /tmp/extracted.json
```

**Never store full article text.** Outline plus counts is enough.

## 3. Two analyses, two outputs

### 3a. Post ideas — grounded in our own work

Read `content/ideas/dev-activity.json`. This is the primary input; it may be nearly empty on a
quiet period, and that is correct — **do not manufacture post ideas from the reference blogs to
fill the run.** The file has one entry per repo under `repos` (`website`, plus the game repo once
`repos.local.json` points at it); each cluster's `commits[].comment` is the full commit body, not
just the subject — that is where the actual "what was it like to build this" material lives. A
cluster with several commits but every `comment` null is a changelog with nothing to say yet; a
cluster with substantive comments is a `learning` or `deep-dive` candidate waiting to be written.
Cluster the commits/PRs/tags into candidate ideas using these five types:

- **`progress`** — what actually got built this period, grounded directly in a cluster from
  `dev-activity.json`. The backbone of a devlog; never skip this type for lack of drama.
- **`deep-dive`** — one system, mechanism or decision explained properly. Most likely to be read
  outside the existing audience.
- **`learning`** — something that went wrong, or a technique that worked. Highest-value type, most
  often avoided because it means admitting a mistake. Look for it deliberately.
- **`milestone`** — a release, a version, a postmortem, a year in review.
- **`refresh`** — an existing post overtaken by events.

Four required inputs: `dev-activity.json`, `content/ideas/blog-index.json` (avoid repeating a topic
already covered), `content/ideas/backlog.json` + `rejected.md` (so the same idea does not resurface),
and — only if new reference posts were extracted this run — their skeletons, used for format
inspiration, never as a topic source.

**Dedup must be semantic.** Compare against `backlog.json` by meaning, against everything ever seen,
not only approved ideas.

### 3b. Practice observations — from the reference blogs

Only from genuinely new/re-read reference-blog posts this run (or the baseline pattern analysis on
first setup). Answer, per _port/blog-pipeline-port-devlog.md section 2's pattern-analysis questions:
cadence and whether it held, post shape, what they show (screenshots/numbers/code/none), how they
handle bad news, what is conspicuously absent. Write worthwhile ones to `practices.json`:

```json
{
  "id": "practice-2026-004",
  "created_at": "2026-08-24",
  "status": "new",
  "observation": "...",
  "source_urls": ["..."],
  "applies_to": "cadence | format | transparency | community | production | tooling | marketing",
  "what_it_would_mean": "...",
  "effort": "low | medium | high",
  "decision": null,
  "decided_at": null
}
```

This is not a scratchpad the pipeline never reads back — it is reviewed and decided, same as
`backlog.json`. **Never auto-decide a practice.**

## 4. Score post ideas

Four axes, 1–5, **higher is always better on all four** — none inverted:

| Axis | 1 | 5 |
| --- | --- | --- |
| `interest` | only I care | a stranger would read this |
| `evidence` | nothing to show yet | screenshots, numbers or code ready now |
| `ease` | needs work not done yet | writable from what exists |
| `durability` | irrelevant in a month | still worth reading in two years |

```
total = 0.35*interest + 0.25*evidence + 0.20*ease + 0.20*durability
```

Score honestly. A backlog where everything scores 4+ is not a backlog. The authoritative formula is
`scoring.formula` in `backlog.json`, which `--validate` parses and recomputes every total against.

## 5. Write the output

Append to `content/ideas/backlog.json` using the schema in `_port/blog-pipeline-port-devlog.md`
section 2.4. Fill `evidence` (the concrete material the post needs — a screenshot, a before/after
number, the actual diff) here, during research, not while writing — it is what separates a real post
from a status update.

**Every new idea gets `status: "new"`. Never approve your own ideas.** The human gate is the only
thing standing between this pipeline and automated content.

Verify what you wrote:

```bash
node scripts/blog-backlog.mjs --validate
```

It must exit 0 before you report.

## 6. Re-raise what is blocked

```bash
node scripts/blog-backlog.mjs --status blocked
```

For each blocked idea, ask its `followup_question` in your report with its age in days. A blocked
idea nobody asks about is the same as a rejected one.

## 7. Report

- any source that came in short, first
- what `dev-activity.json` covered (span, commit count, cluster themes) — even if thin
- new reference-blog posts, per source, if any
- the new post ideas with scores and one line of reasoning each
- new practice observations, if any
- the blocked-idea follow-ups
- review commands: `node scripts/blog-backlog.mjs`, `--show <id>`, `--approve`, `--reject --reason`

## Cadence

Discovery is cheap and can run any time. The *reminder* (`blog-weekly.mjs --check`) is paced to
`cadence_days` in `blog.config.json` (30, monthly) — see devlog doc section 2.7 for why weekly
would train the reminder to be ignored. When the backlog holds more approved ideas than can be
written soon, say so instead of generating more.
