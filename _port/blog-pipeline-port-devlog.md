# Devlog variant of the pipeline

Adaptation of the pipeline for a **personal studio devlog**: development progress, learnings, and
related topics. Reference blogs: Factorio FFF, Yacht Club Games, Stardew Valley, Archmage Rises.

> **Note (kept for the historical record):** the two files this document originally referenced —
> `blog-automation.md` (the origin pipeline's own architecture doc) and `blog-pipeline-port.md`
> (the general porting mechanics) — have been removed from this repo. Both carried a different
> company's real competitor list and business specifics, which do not belong in this public repo.
> This repo's own equivalent is [`docs/blog-automation.md`](../docs/blog-automation.md); the porting
> mechanics already happened and are not needed again here. The sections below are left as written
> at the time, since they are what actually produced this repo's pipeline.

Read alongside `blog-pipeline-port.md`. That file covers the mechanics — what to copy, the config
schema, the Astro/GitHub Pages specifics. **This file overrides the genre.** Where the two
disagree, this one wins.

---

## 1. The one thing that must be understood first

The original pipeline is an **SEO gap machine**. It reads competitors to find topics they rank for
and we do not, so we can take that traffic. Every part of it — `coverage-gap`, `primary_keyword`,
`funnel_stage`, `cannibalisation`, the `demand` score — serves that goal.

**A devlog does not work that way.** Nobody reads Factorio Friday Facts because it out-ranks a rival
on "factory game optimisation". They read it because the developers show what they actually built
that week.

So the genre inverts the source of truth:

| | SEO blog | Devlog |
| --- | --- | --- |
| Topics come from | competitor gaps | **your own development** |
| Other blogs are | rivals to out-rank | **references for format and cadence** |
| Success is | search position | readers who return |
| The scarce input is | keyword research | **evidence: screenshots, numbers, code** |

**The failure mode this variant exists to prevent: a devlog about other people's devlogs.** If the
research half only reads the four reference blogs, that is exactly what it produces. The reference
blogs teach you *how* to write a devlog. Your git history tells you *what* to write about.

That is why this variant adds a fifth input the original does not have, and why it produces two
outputs instead of one.

---

## 2. What changes

### 2.1 A new deterministic input: your own development

Write `scripts/blog-devlog.mjs`. Deterministic, no network, no tokens, in the same style as the other
scripts:

```bash
node scripts/blog-devlog.mjs                    # activity since the last published post
node scripts/blog-devlog.mjs --since 2026-06-01
```

Reads `git log`, merged PRs, closed issues, tags/milestones since the date of the newest published
post, and writes `content/ideas/dev-activity.json`: commits grouped by area, files touched most,
merged branches, tags, and the span covered. Cluster by commit-message prefix and directory, not by
individual commit — the analysis needs themes, not a changelog.

This replaces `ranking-gap` (the Google Search Console idea type that was never wired up). It is the
primary topic supply. A run without it produces speculation.

### 2.2 A new discovery method: RSS

`blog-sources.mjs` supports `method: "sitemap"` and `method: "html"` only. Devlogs almost always
publish an RSS or Atom feed, and a feed is a **better** source than either: it is stable, dated, and
intended for machine consumption.

Add `method: "rss"`. Parse `<item><link>` / `<entry><link href>` and `<pubDate>` / `<updated>` into
the same `{loc, lastmod}` shape `collectSitemap` returns, so nothing downstream changes. Check for a
feed before falling back to sitemap or HTML scraping on each of the four references.

One caveat: many feeds carry only the most recent 10–20 entries. That is fine for `--delta` and wrong
for `--baseline`. Where a feed is truncated, use sitemap or HTML for the baseline run and the feed
for weekly deltas, and record which is which in the source's `notes`.

### 2.3 Two outputs, not one

One research run, two artefacts, both gated by you.

**`backlog.json`** — post ideas, as before, with the schema changes in 2.4.

**`practices.json`** — *new*. Things observed in the reference blogs that are worth adopting in your
own work, whether or not they ever become a post. This is the "Themen für meine Entwicklung" half.

```json
{
  "id": "practice-2026-004",
  "created_at": "2026-08-24",
  "status": "new",
  "observation": "Factorio ships FFF every Friday, without exception, including weeks with nothing finished.",
  "source_urls": ["https://factorio.com/blog/post/fff-400"],
  "applies_to": "cadence",
  "what_it_would_mean": "A fixed slot beats a quality bar. A short honest post on a slow week keeps the habit alive; skipping once makes skipping normal.",
  "effort": "low",
  "decision": null,
  "decided_at": null
}
```

`applies_to` is one of: `cadence`, `format`, `transparency`, `community`, `production`, `tooling`,
`marketing`. Status flow is `new → adopted | rejected | deferred`, with a reason on anything other
than `adopted`.

This is not `findings_outside_backlog` renamed. That array is a scratchpad the pipeline never reads
back. `practices.json` is reviewed, decided, and dated — otherwise the observations accumulate and
nothing changes.

### 2.4 Idea types and schema

Replace the four SEO types with five devlog types:

- **`progress`** — what actually got built this period. Ground it in `dev-activity.json`. The
  backbone of a devlog and the one that must never be skipped for lack of drama.
- **`deep-dive`** — one system, mechanism, or decision explained properly. The Factorio FFF pattern
  and the type most likely to be read outside your existing audience.
- **`learning`** — something that went wrong, or a technique that worked. The highest-value type and
  the one that gets avoided, because it means admitting mistakes.
- **`milestone`** — a release, a version, a postmortem, a year in review.
- **`refresh`** — an existing post overtaken by events. Keep it; it survives the genre change intact.

Drop from the idea schema: `primary_keyword`, `secondary_keywords`, `search_intent`, `funnel_stage`.
They belong to search-driven content and carrying them over invites keyword-stuffed devlog posts,
which is the single most reliable way to make a devlog unreadable.

Add: `evidence` — the concrete material the post needs (`"screenshot of the pathfinding debug view"`,
`"before/after frame times"`, `"the actual diff"`). This is the devlog counterpart of `assets_needed`
and is what separates a real post from a status update. Fill it during research, not while writing.

Keep unchanged: `id`, `created_at`, `status`, `working_title`, `angle`, `outline_hint`, `locale`,
`source_urls`, `internal_links`, `notes`, `assigned_slug`, and the whole status machine including
`blocked`.

### 2.5 Scoring

The four SEO axes do not transfer. `demand` has no meaning without search volume. Replace them,
keeping the two rules that matter: **exactly four axes, and higher is always better on all four.**

| Axis | 1 | 5 |
| --- | --- | --- |
| `interest` | only I care | a stranger would read this |
| `evidence` | nothing to show yet | screenshots, numbers or code ready now |
| `ease` | needs work I have not done | writable from what exists |
| `durability` | irrelevant in a month | still worth reading in two years |

```
total = 0.35*interest + 0.25*evidence + 0.20*ease + 0.20*durability
```

Weights are a starting point. Put them in `scoring.formula` in `backlog.json` — that string stays the
single authority, and `blog-backlog.mjs --validate` recomputes every total against it. Changing the
weighting means editing that string and nothing else.

`durability` carries real weight on purpose: a devlog whose archive is worth reading compounds, and
one that is a stream of weekly status updates does not.

### 2.6 Honesty rules, reframed

The original rules exist for competitor comparisons and Google's scaled-content policy. Most do not
apply. These replace them, and they are what makes a devlog trusted rather than promotional:

- **Never claim progress that did not happen.** A slow week is a post about a slow week.
- **Date every screenshot and every number.** Builds change; a stale screenshot reads as a lie later.
- **Show the failed attempt, not only the version that worked.** This is what readers come back for
  and what makes the post useful to another developer.
- **Do not announce dates you are not confident in.** The reference blogs' community damage is
  almost entirely from missed announced dates, not from slow development.
- **Say when something is cut.** Silently dropping a promised feature is noticed and remembered.

Delete the competitor-disclosure rule and its lint check, or repurpose the check: if the posts name
tools, engines or other studios, a short "what I use and why" line is the honest equivalent. Decide
which, then make the lint match the decision — do not leave a check enforcing a rule that no longer
exists.

### 2.7 Cadence

Research monthly, not weekly. Four reference blogs that publish rarely produce an empty delta most
weeks, and an empty delta every week trains you to ignore the nudge. Set `cadence_days: 30`.
Discovery itself is free, so running it weekly is harmless — but let the *reminder* fire monthly.

**Your own publishing cadence is a separate decision and a more important one.** The clearest lesson
from all four references is that the schedule is the product. Pick a slot you can hold on a bad week,
not a good one, and write it into the skill so the pipeline enforces it rather than hoping.

---

## 3. What carries over untouched

Do not redesign these. Each closes a specific hole and the genre change does not affect any of them:

- Discovery with `seen.json` dedup, committed to the repo
- `expected_min` per source, exit 2 on a short source, `complete: false` propagated into the artefacts
- `lastRun()` ignoring incomplete runs so a half-failed run does not silence the nudge
- `blog-check.mjs` running every gate and continuing after a failure
- `--validate` recomputing scores from `scoring.formula`
- The `new → approved → in_progress → drafted → published` status machine, and `blocked` with its
  ageing follow-up question
- **The human approval gate.** Never auto-approve. This matters more for a personal blog, not less —
  it is your voice.
- Never storing full article text; outline plus counts only
- The four gates: inventory, conventions, images, backlog

---

## 4. The prompt

Hand this to a Claude Code agent in the Astro repository, together with `_port/`.

---

> Port the blog automation pipeline in `_port/` into this repository, adapted for a **personal studio
> devlog**.
>
> ### Read first, in this order
>
> 1. `_port/blog-automation.md` — how the pipeline works and why. Do not relitigate its decisions.
> 2. `_port/blog-pipeline-port.md` — the porting mechanics. **Section 3.1 is mandatory**: this repo is
>    Astro on GitHub Pages.
> 3. `_port/blog-pipeline-port-devlog.md` — the genre adaptation. **Where it disagrees with the other
>    two, it wins.**
>
> ### The context
>
> This is a personal studio devlog covering development progress, learnings and related topics.
> Reference blogs — not competitors:
>
> - https://factorio.com/blog/
> - https://www.yachtclubgames.com/blog/
> - https://www.stardewvalley.net/blog/
> - https://www.archmagerises.com/news
>
> **These blogs are references for format and cadence, not a supply of topics.** Topics come from the
> user's own development. A pipeline that only reads these four produces a devlog about other people's
> devlogs, which is the specific failure this adaptation exists to prevent. Read section 1 of the
> devlog document before writing any part of the research skill.
>
> ### Step 0 — establish the stack facts. Do not guess.
>
> Determine from this repository, before writing a single check:
>
> - the `base` value in `astro.config.mjs` — a GitHub Pages project path silently 404s every internal
>   link written without it
> - `.md` or `.mdx` — every script filters `.endsWith('.md')` and reports success on zero posts
> - `public/` or `src/assets/` for images
> - where posts live and the collection layout; one locale or several
> - the zod schema in `src/content.config.ts` — that is the frontmatter contract, use it rather than
>   re-declaring an allowlist
> - this repo's own pre-commit gate
>
> Ask the user only what the repository cannot tell you.
>
> ### Step 1 — port the deterministic core
>
> Follow step 2 of the port document's prompt. Copy the eight scripts, create `blog.config.json`,
> adapt `blog-lint.mjs` and `blog-assets.mjs` to Astro. Preserve every property listed there as
> non-negotiable — the exit-2 source guard, `lastRun()` ignoring incomplete runs, `blog-check.mjs`
> continuing after a failure, case-exact asset paths, four score axes all pointing the same way.
>
> Then the two additions this variant needs:
>
> - **`method: "rss"` in `blog-sources.mjs`** — parse feed entries into the same `{loc, lastmod}` shape
>   `collectSitemap` returns so nothing downstream changes. Check each reference for a feed before
>   falling back to sitemap or HTML scraping. Note truncated feeds in the source's `notes`; use
>   sitemap or HTML for `--baseline` and the feed for `--delta` where that happens.
> - **`scripts/blog-devlog.mjs`** — see section 2.1. Reads git history since the newest published post,
>   writes `content/ideas/dev-activity.json`, clusters by theme rather than listing commits.
>   Deterministic, no network, no tokens, same style as the existing scripts.
>
> ### Step 2 — state files
>
> As in the port document, plus `practices.json` (schema in section 2.3) and `dev-activity.json`.
> `seen.json` **must be committed**.
>
> Set `cadence_days: 30`. Wire `blog:weekly`, `blog:check`, `blog:lint`, `blog:assets` and a new
> `blog:dev` into `package.json`, and install the `SessionStart` hook.
>
> ### Step 3 — Phase 0 on the four references
>
> Per source: find the feed, then sitemap, then HTML listing. Probe reachability with
> `blog-sources.mjs --probe`. Determine `pathFilter`, record whether dates are available, set
> `expected_min` to the verified count minus a small tolerance, and test extraction.
>
> **A `WebFetch` 403 does not mean the site blocks bots** — verify with `--probe`. In the origin repo
> that single wrong conclusion nearly dropped 178 of 306 posts. `WebFetch` counts are unreliable;
> treat script output as fact. `curl` may have no sandbox network access while Node's `fetch` does.
>
> Expect these four to behave differently from a SaaS marketing blog: long posts, irregular schedules,
> heavy images, and possibly a forum or Steam-news feed rather than a CMS. If a source cannot be
> discovered reliably, say so and set `"enabled": false` rather than building something fragile.
>
> Then run `--baseline`, do the pattern analysis, and `--seed`.
>
> ### Step 4 — the baseline pattern analysis
>
> Different from the origin's gap analysis. Do not look for topic gaps. Answer:
>
> - **Cadence** — how often does each publish, and has it held? Where it slipped, what happened?
> - **Post shape** — length, heading count, image-to-text ratio, how a post opens and closes.
> - **What they show** — screenshots, gifs, numbers, code, art process, none of the above.
> - **How they handle bad news** — delays, cut features, mistakes. This is where trust is won or lost.
> - **What is conspicuously absent** — what these blogs never talk about, and whether that is
>   discipline or an opportunity.
>
> Output goes to `practices.json`, not `backlog.json`. Post ideas come from `dev-activity.json`, which
> at this point may be nearly empty — that is correct and expected. Do not manufacture post ideas from
> the reference blogs to fill the run.
>
> ### Step 5 — the skills
>
> Rewrite both. Copy their structure and guard rails, replace all genre content.
>
> `blog-research` — five inputs now: extracted reference posts, `blog-index.json`,
> **`dev-activity.json`**, `backlog.json` + `rejected.md`, and `practices.json`. Two outputs: post
> ideas and practice findings. The five idea types and the four scoring axes from sections 2.4 and
> 2.5. Keep semantic dedup, keep re-raising blocked ideas, and keep **"every new idea gets
> `status: new` — never approve your own ideas."**
>
> `blog-write` — keep the shape: pick from `--next` only, research before structuring, **present the
> outline and wait for approval before writing**, verify with `blog:check` before claiming done.
> Replace the conventions with this site's, and the honesty rules with those in section 2.6.
>
> Delete everything belonging to the origin: the AI-rendering competitors, its no-go areas, its
> verified chart palette (validated against one brand on a light surface, not transferable), its
> `PRE_PIPELINE_SLUGS`, its posthog build caveat, its "Sie" address rule, its disclosure wording, and
> every SEO field.
>
> Ask the user for their publishing cadence and write it into `blog-write` as a rule, not a
> suggestion. The clearest lesson from all four references is that the schedule is the product.
>
> ### Step 6 — cold start
>
> A new devlog has no posts. `min_internal_links: 2` is unsatisfiable — set it to 0, raise to 1 at
> three posts and 2 at five, and write the raise into the config as a comment. An unsatisfiable gate
> gets disabled and never comes back. Word and H2 bands cannot be derived from an empty corpus; leave
> them wide and recalibrate at five posts. `legacy_slugs` starts empty and is never used to silence a
> finding on a post you wrote.
>
> ### Step 7 — verify
>
> - [ ] `--delta` returns 0 new immediately after `--seed`
> - [ ] `npm run blog:check` passes with every gate genuinely active, none stubbed
> - [ ] Temporarily raising one `expected_min` makes the weekly run print `SOURCE FAILURE` and exit 1.
>       **Test this** — a silently broken source looks exactly like a quiet month
> - [ ] `blog-backlog.mjs --validate` exits 0
> - [ ] `blog-devlog.mjs` produces sensible themes from real git history
> - [ ] An internal link written without the Astro `base` prefix is caught by the lint
> - [ ] The `SessionStart` hook fires when due and is silent when not
> - [ ] `seen.json` is committed
>
> Then write this repo's own `docs/` page. **Do not copy the origin's**. Record the sources you
> verified, the counts you measured, the extraction failures you hit. Its value is that every number
> in it was checked.
>
> ### Do not
>
> - Do not auto-approve ideas or practices.
> - Do not lower an `expected_min` to clear a FAIL. Fix the source, or set `"enabled": false`.
> - Do not generate post ideas from the reference blogs. They supply format, not topics.
> - Do not carry over SEO fields, keyword targeting, or the origin's competitor findings.
> - Do not add full-body fetching, a headless browser, or a second state store.
> - Do not publish. `published` is set after a merge, and the merge is the user's call.
