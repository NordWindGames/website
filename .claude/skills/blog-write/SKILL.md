---
name: blog-write
description: Turn an approved idea from content/ideas/backlog.json into a publishable bilingual devlog post (EN + DE) with assets, internal links and verification. Use when asked to write the next devlog post, draft a post from the backlog, or work on a specific idea id.
---

# Writing a devlog post from the backlog

Read `docs/blog-automation.md` and `_port/blog-pipeline-port-devlog.md` if you have not. The two
steps people skip — **structure approval before writing** and **the verification block at the
end** — are the two that decide whether the result is publishable.

**Publishing cadence: weekly.** This is a rule, not a suggestion — the clearest lesson from all four
reference blogs (Factorio, Yacht Club Games, Stardew Valley, Archmage Rises) is that the schedule is
the product. If it has been more than a week since the last published post and nothing is
`approved`, say so plainly rather than silently letting the slot pass — a short, honest "not much
happened" post beats silence (devlog honesty rules, below).

---

## 1. Pick the idea

```bash
node scripts/blog-backlog.mjs --next
```

Returns the `approved` idea with the highest `scores.total`. **Never take "the next row"**, never
take a `new` or `blocked` idea. If nothing is approved, stop and say so — that is the human gate
working, not an obstacle to route around.

If the user names an id, use it, but check its status first.

Claim it: set `status` to `in_progress` and `assigned_slug` to the chosen slug (lowercase kebab-case,
no locale marker in the name) directly in `content/ideas/backlog.json`.

A `type: "refresh"` idea edits an existing pair of files instead of creating new ones: update `date`
and keep the existing slug and URL.

## 2. Research before structuring

1. **`dev-activity.json` and the idea's `evidence` field** — what to actually show: a screenshot, a
   before/after number, the real diff. If the evidence listed does not exist yet (the screenshot was
   never taken, the benchmark never run), say so before writing rather than describing it from memory.
2. The idea's `source_urls`, if any (reference-blog posts) — for format inspiration only, via
   `scripts/blog-extract.mjs`, never as a topic source.
3. `content/ideas/blog-index.json` — our own inventory, for internal link targets and to avoid
   repeating a topic already covered.

## 3. Propose the structure, then wait

**Do not write the post before the outline is agreed.** Present:

- what evidence is actually ready vs. still needed
- the H2 outline
- any assumption or figure you need the user to confirm
- anything you found that you intend **not** to use, and why

## 4. Write

Both locales, identical filename:

```
src/content/blog/en/<slug>.md
src/content/blog/de/<slug>.md
```

### Conventions that are not negotiable

- **Frontmatter is `title`, `description`, `date` only** — enforced by the zod `.strict()` schema in
  `src/content.config.ts`. An extra field is a build error, not a silent drop; check that file before
  inventing a new one.
- **Address the reader informally** (English: plain second person; German: `du`, not `Sie`) — this is
  a personal devlog, not a corporate blog.
- **Hero image directly under the frontmatter**, before the first paragraph.
- **No FAQ section required** — dropped for the devlog genre (it was SEO rich-results bait).
- **Internal links**: `content/ideas/blog.config.json`'s `min_internal_links` ramp applies (0 until 3
  posts exist, then 1, then 2 at 5 posts) — do not hand-wave past whatever it currently requires.
  English: `/blog/<slug>`. German: `/de/blog/<slug>`.
- Images go in `public/blog/<slug>/`. Photos as `.webp`, diagrams as `.svg`.
- If the post names a tool, engine or another studio, and that term is listed in
  `blog.config.json`'s `disclosure_trigger_terms`, add a short "what I use and why" line — the
  repurposed, non-promotional version of the origin pipeline's competitor-disclosure rule. If the
  term is not yet in that list but should trigger the rule going forward, add it.

### The honesty rules (devlog doc section 2.6 — these are what make it trusted, not promotional)

- **Never claim progress that did not happen.** A slow week is a post about a slow week.
- **Date every screenshot and every number.** Builds change; a stale screenshot reads as a lie later.
- **Show the failed attempt, not only the version that worked.** This is what readers come back for.
- **Do not announce dates you are not confident in.**
- **Say when something is cut.** Silently dropping a promised feature is noticed and remembered.

## 5. Assets

Load the `dataviz` skill before making any chart. Do not eyeball colour — run its validator; the
origin pipeline's verified palette was validated against a different brand's ramps on a light
surface and does not transfer here, so re-derive one rather than reusing those hex values.

Set `viewBox` plus `width="100%"` on any SVG diagram — `scripts/blog-assets.mjs` fails on a missing
one, because without it the diagram cannot scale responsively inside the fluid content column. Use
an aspect ratio between `blog.config.json`'s `assets.svg_ratio` band (1:1–3.2:1 by default) for the
~768px prose column (`assets.prose_width_px`) — re-verify both against `src/layouts/BlogLayout.astro`
if that layout's width ever changes.

You cannot see the rendered SVG. Compute label widths and check for collisions numerically, then
**send the file to the user with `SendUserFile` and say you have not viewed it.**

## 6. Verify — all of it, before claiming done

```bash
npm run blog:check
```

This runs all four gates and keeps going after a failure, so one run shows every problem instead of
the first one:

- **conventions** (`blog-lint.mjs`) — frontmatter present and ISO-dated, EN and DE both exist under
  the identical filename, hero image directly under the frontmatter, the disclosure line when a
  trigger term is named, internal link count and locale prefix, no link to a route that does not
  exist, word/H2 counts inside whatever band `blog.config.json` currently declares (wide open until
  recalibrated at 5 posts). It also prints inbound links per slug.
- **images** (`blog-assets.mjs`) — files exist, paths are case-exact for the Linux deploy target,
  every SVG has a readable `viewBox`.
- **backlog** (`blog-backlog.mjs --validate`) — the idea you just moved to `drafted` really has an
  `assigned_slug` and that slug really has files in both locales.

`blog:check` must be clean before you claim done. This repo has no separate `npm run lint` script —
`npm run build` (which type-checks and validates the content collection schema) is the other check
worth running if you touched anything beyond the two markdown files.

## 7. Hand over

Set the idea to `drafted`, note what was produced, commit both locales plus assets in one commit,
and give the user the word counts and what still needs their input. `published` is set only after
the post is actually live — that is a merge, and a merge is the user's call.
