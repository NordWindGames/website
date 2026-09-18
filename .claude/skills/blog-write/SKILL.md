---
name: blog-write
description: Turn an approved idea from content/ideas/backlog.json into a publishable bilingual devlog post (EN + DE) with assets and verification. Use when asked to write the next devlog post, draft a post from the backlog, or work on a specific idea id.
---

# Writing a devlog post from the backlog

`docs/blog.md` describes the pipeline. The two steps people skip — **structure approval before
writing** and **`npm run blog:check` at the end** — are the two that decide whether the result is
publishable.

**Publishing cadence: weekly.** A rule, not a suggestion: the clearest lesson from the reference
blogs is that the schedule is the product. If it has been more than a week and nothing is approved,
say so plainly rather than letting the slot pass. A short, honest "not much happened" post beats
silence.

## 1. Pick and claim the idea

```bash
node scripts/blog.mjs idea --next                                  # top-scored approved idea
node scripts/blog.mjs set in_progress <id> --slug <kebab-case>     # claim it
```

**Never take "the next row"**, never a `new` or `blocked` idea. If nothing is approved, stop and say
so — that is the human gate working, not an obstacle to route around. If the user names an id, use
it, but check its status first.

A `type: "refresh"` idea edits an existing pair of files: update `date`, keep the slug and URL.

## 2. Research before structuring

Read `content/ideas/scan.json` — it holds our git activity (`activity`), our own posts (`posts`) and
the shape of recent reference-blog posts (`extracted`) in one snapshot. Plus the idea's own
`evidence` field: what you are actually going to show — a screenshot, a before/after number, the
real diff.

**If the evidence does not exist yet** (the screenshot was never taken, the benchmark never run),
say so before writing rather than describing it from memory.

For a reference post not already in `scan.json`: `node scripts/blog.mjs extract <url>`. Format
inspiration only, never a topic source.

## 3. Propose the structure, then wait

**Do not write before the outline is agreed.** Present: what evidence is ready vs. still needed; the
H2 outline; any assumption or figure the user must confirm; and anything you found that you intend
**not** to use, and why.

## 4. Write

Both locales, identical filename: `src/content/blog/{en,de}/<slug>.md`.

- **Frontmatter is `title`, `description`, `date` — nothing else.** Enforced by the zod `.strict()`
  schema in `src/content.config.ts`, where an extra field is a build error, not a silent drop.
- **Hero image directly under the frontmatter**, before the first paragraph.
- Images in `public/blog/<slug>/`. Photos `.webp`, diagrams `.svg`.
- Internal links keep their trailing slash: English `/blog/<slug>/`, German `/de/blog/<slug>/`,
  game page `/holdstrong/`. `trailingSlash: 'always'` in `astro.config.mjs` makes the slashless
  form a redirect hop.
- **If the post names a tool, engine or another studio, add a short "what I use and why" line.** Not
  promotional, not a neutrality disclaimer — just say what you use and why you picked it.

Everything else about links, slugs and images is checked in step 6; write naturally and let the gate
tell you what it does not like.

### The voice — one solo developer talking, not a studio publishing

The benchmark is `what-the-ice-sends` in both locales. Match it. Every rule below exists because a
draft got rewritten for breaking it.

- **First person, and own every decision.** "I gave myself a rule", "my biggest hurdle", "an enemy I
  was fond of", "I only noticed it afterwards". One person designs, draws and builds this game; a
  post that hides that behind "the design document says" or the passive voice reads like a press
  release. Where the solo-dev reality explains a delay or a gap, say it outright — it is context,
  not an excuse.
- **Pronouns.** German: `du` for the player inside the fiction, `ihr` for the readers of the post,
  never `Sie`. Keep the two apart — the split is doing real work, since "du stehst am Turm" and
  "was ihr hier seht" are addressing different people. English has one `you` for both.
- **Write to be read once.** A sentence that needs a second pass gets split. Prefer the explicit
  connective — _so_, _that is why_, _deshalb_, _zusammenfassend_ — over the jump cut that leaves the
  reader to infer the link. Aphorisms feel sharp to write and cost the reader every time.
- **At most one em dash per paragraph.** A second one means the sentence wanted to be two
  sentences. The same goes for stacked appositions and parentheses inside parentheses.
- **Gloss the lore the first time it appears.** "the great wolf Fenrir", "the larva of Nidhöggr",
  "Rimehold, the outpost you hold". Readers have not read `story.md`, and a name they cannot place
  is a name they skim past.
- **Be fond of the thing out loud.** "There is one detail I like enormously", "the most useful line
  in my entire design document". Warmth is what separates a devlog from patch notes; the cold,
  clipped register reads as marketing copy trying to sound literary.
- **End a section by saying what it meant.** Do not leave a punchy fragment to carry the point —
  land it in a plain sentence, then move on.

### The honesty rules — these are what make a devlog trusted rather than promotional

- **Never claim progress that did not happen.** A slow week is a post about a slow week.
- **Date every screenshot and every number.** Builds change; a stale screenshot reads as a lie later.
- **Show the failed attempt, not only the version that worked.** This is what readers come back for.
- **Do not announce dates you are not confident in.**
- **Say when something is cut.** Silently dropping a promised feature is noticed and remembered.

## 5. Assets

Load the `dataviz` skill before making any chart, and run its validator rather than eyeballing
colour — do not reuse a palette validated for a different brand.

Give every SVG diagram a `viewBox` and `width="100%"`, sized for the ~768px prose column
(`assets.prose_width_px`; re-verify against `src/layouts/BlogLayout.astro` if that ever changes).

**You cannot see the rendered SVG.** Compute label widths and check for collisions numerically, then
send the file to the user and say you have not viewed it.

## 6. Verify

```bash
npm run blog:check       # conventions, images, backlog - keeps going after a failure
npm run build            # type-checks and validates the content collection schema
```

`blog:check` must be clean before you claim done. It reports every problem in one run rather than
stopping at the first. If a gate rejects something you believe is correct, say so instead of
working around it — the gate may be wrong, and that is worth knowing.

## 7. Hand over

```bash
node scripts/blog.mjs set drafted <id>     # refuses unless both locale files exist
```

Give the user the word counts and what still needs their input. **`published` is set only after the
post is actually live** — that is a merge, and a merge is the user's call.
