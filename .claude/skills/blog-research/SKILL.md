---
name: blog-research
description: Periodic devlog idea generation. Reads our own git history plus the reference blogs, generates scored post ideas and practice observations, and appends them to content/ideas/backlog.json. Use when asked to find new devlog ideas, run the devlog research, or refresh the backlog.
---

# Devlog idea generation

`docs/blog.md` describes the pipeline and why the human gate is not optional.

The failure mode this procedure exists to prevent: **a devlog about other people's devlogs.** The
reference blogs teach *how* to write a devlog. They are not a topic supply. **Topics come from our
own development** — the `activity` section of `scan.json`.

## 1. Scan (deterministic, no tokens)

```bash
npm run blog:scan
```

One command: reference blogs, our own git activity, our own post inventory, and the shape of new
reference posts — all into `content/ideas/scan.json`.

Read the source table it prints:

- **A `FAIL` means a reference blog changed its structure, not that the threshold is wrong.** Fix
  the endpoint or `pathFilter` in `content/ideas/sources.local.json` (gitignored — the real URLs
  live only there). **Never lower `expected_min` to clear it.** To retire a source deliberately,
  set `"enabled": false`.
- **A non-zero exit means a source came in short.** The snapshot is still written but carries
  `complete: false`. Say so at the top of your report and be more cautious about pattern claims
  from that source.
- `cached` means the source answered 304 and was not refetched. Its count comes from the last real
  fetch and is still checked against `expected_min`, so a cached source can still FAIL.
- If it says `repos.local.json is not set up`, this is website-repo activity only — **say that in
  your report** rather than treating it as the whole picture. The game repo is the one that matters.

An empty delta from the reference blogs is normal; several publish rarely. Thin *own* activity is
the informative signal: development was slow, and a devlog can say so honestly.

## 2. Post ideas — grounded in our own work

`scan.json`'s `activity.repos[].clusters` is the primary input. It may be nearly empty on a quiet
period, and that is correct — **do not manufacture ideas from the reference blogs to fill the run.**

Each cluster is already grouped by commit type with its directories. The judgement you add is
reading `commits[].comment` — the full commit body, not the subject. **That is where the "what was
it like to build this" material lives.** A cluster whose comments are all `null` is a changelog with
nothing to say yet; one with substantive comments is a `learning` or `deep-dive` waiting to be
written.

Five types:

- **`progress`** — what actually got built. The backbone of a devlog; never skip it for lack of drama.
- **`deep-dive`** — one system, mechanism or decision explained properly. Most likely to be read
  outside the existing audience.
- **`learning`** — something that went wrong, or a technique that worked. **Highest-value type, most
  often avoided because it means admitting a mistake. Look for it deliberately.**
- **`milestone`** — a release, a version, a postmortem, a year in review.
- **`refresh`** — an existing post overtaken by events.

Also read: `scan.json`'s `posts` (avoid repeating a covered topic), the existing backlog
(`node scripts/blog.mjs idea`) and `content/ideas/rejected.md`.

**Dedup must be semantic.** Compare by meaning against everything ever seen, not only approved
ideas — the script only catches an identical title, and only as a warning.

## 3. Practice observations — from the reference blogs

Only from genuinely new reference-blog posts this run (`scan.json`'s `extracted`). Ask: what cadence
do they keep and did it hold? What shape is a post? What do they show — screenshots, numbers, code,
nothing? **How do they handle bad news?** What is conspicuously absent?

Worthwhile observations go in as `kind: "practice"` with `applies_to` one of
`cadence | format | transparency | community | production | tooling | marketing`, plus
`what_it_would_mean` and `effort`. They are reviewed and decided like any idea. **Never
auto-decide a practice.**

## 4. Score the post ideas

Four axes, integers 1–5, **higher is always better on all four** — none inverted:

| Axis | 1 | 5 |
| --- | --- | --- |
| `interest` | only I care | a stranger would read this |
| `evidence` | nothing to show yet | screenshots, numbers or code ready now |
| `ease` | needs work not done yet | writable from what exists |
| `durability` | irrelevant in a month | still worth reading in two years |

**Write the four integers only.** Do not compute a total — the weighting lives in
`blog.config.json`'s `scoring.weights` and the script does the arithmetic.

Score honestly. A backlog where everything scores 4+ is not a backlog.

## 5. Write the output

Pipe JSON to `add` — one object or an array:

```bash
node scripts/blog.mjs add <<'JSON'
[{ "type": "learning", "working_title": "...", "angle": "...", "locale": "both",
   "internal_links": [], "evidence": "the concrete thing the post will show",
   "source_urls": [], "outline_hint": "...",
   "scores": { "interest": 4, "evidence": 3, "ease": 4, "durability": 3 } }]
JSON
```

Ids are assigned, dates stamped, and **status is forced to `new`** — the command will not let you
approve your own output. It validates before writing and refuses the whole batch on any error.

Fill `evidence` **here, during research**, not while writing: the concrete material the post needs
(a screenshot, a before/after number, the actual diff). It is what separates a real post from a
status update.

## 6. Re-raise what is blocked

```bash
node scripts/blog.mjs idea --status blocked
```

Ask each blocked idea's follow-up question in your report, with its age. A blocked idea nobody asks
about is the same as a rejected one. Record what came of asking with
`node scripts/blog.mjs note <id> "..."`.

## 7. Report

In this order:

1. any source that came in short, or a cached source worth re-checking
2. what our own activity covered (span, commit count, cluster themes) — even if thin
3. new reference-blog posts per source, if any, and how many were **not** extracted
4. the new ideas with scores and one line of reasoning each
5. new practice observations
6. the blocked-idea follow-ups
7. review commands: `node scripts/blog.mjs idea`, `idea <id>`,
   `set approved <id>`, `set rejected <id> --reason "..."`

When the backlog already holds more approved ideas than can be written soon, say so instead of
generating more.
