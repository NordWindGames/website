/**
 * The single corpus reader: one pass over src/content/blog/<locale>/*.md.
 *
 * This replaces five separate disk walks (lint, assets, index, devlog, backlog), three copies of
 * splitFrontmatter with two different return shapes, four markdown regex variants across three
 * conventions, and two word-count spellings - one of which used split(' ') and therefore counted
 * newline-separated words as one, so the pipeline's two word_count fields were not comparable.
 *
 * Frontmatter *shape* is enforced by the zod .strict() schema in src/content.config.ts, where an
 * extra or misspelled field is a build error. This reader is deliberately lenient: it parses what
 * is there so the gates can report presence and format, and never re-declares the allowlist.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG, POSTS_DIR, rel } from './ctx.mjs'

/** Text links, excluding image references. Stops at whitespace so `](/x.png "title")` works. */
const LINK_RE = /(?<!!)\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g
/** Image references, same bracket convention as LINK_RE. */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g
const H2_RE = /^##\s+(.+)$/gm

/**
 * Minimal frontmatter reader, dependency-free. `data` is null when there is no block at all.
 *
 * This is a regex, not a YAML parser, which is the point - the shape contract belongs to the zod
 * schema in src/content.config.ts. But being more permissive than YAML means it can accept a block
 * that Astro then refuses to parse, so `yamlRisks` reports the one case that actually bites:
 * an unquoted value containing ": ", which YAML reads as a nested mapping. A game called
 * "HoldStrong: The Last Tower" hits this in every title or description that names it.
 */
export function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: null, body: raw, yamlRisks: [] }

  const data = {}
  const yamlRisks = []
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue

    const [, key, rawValue] = kv
    const value = rawValue.trim()
    const quoted = /^(".*"|'.*')$/.test(value)
    if (!quoted && /:\s/.test(value)) yamlRisks.push({ key, value })

    data[key] = value.replace(/^["'](.*)["']$/, '$1')
  }
  return { data, body: m[2], yamlRisks }
}

/**
 * Read every post once.
 *
 * Returns locales as they exist *on disk*, not as blog.config.json lists them. That distinction
 * matters: with only src/content/blog/en/ present, a pairing check against the config would fail
 * every post, while a check against the disk correctly reports nothing to pair yet.
 */
export function readCorpus() {
  const locales = existsSync(POSTS_DIR)
    ? readdirSync(POSTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : []

  const files = []
  for (const locale of locales) {
    const names = readdirSync(join(POSTS_DIR, locale))
      .filter((f) => f.endsWith('.md'))
      .sort()

    for (const name of names) {
      const file = join(POSTS_DIR, locale, name)
      const { data, body, yamlRisks } = splitFrontmatter(readFileSync(file, 'utf8'))

      files.push({
        locale,
        slug: name.replace(/\.md$/, ''),
        file,
        where: rel(file),
        data,
        body,
        yamlRisks,
        h2: [...body.matchAll(H2_RE)].map((m) => m[1].trim()),
        words: body.split(/\s+/).filter(Boolean).length,
        links: [...body.matchAll(LINK_RE)].map((m) => m[2]),
        images: [...body.matchAll(IMAGE_RE)].map((m) => ({ alt: m[1], src: m[2] })),
      })
    }
  }

  const bySlug = new Map()
  for (const post of files) {
    if (!bySlug.has(post.slug)) bySlug.set(post.slug, [])
    bySlug.get(post.slug).push(post)
  }

  const slugsByLocale = new Map(
    locales.map((l) => [l, new Set(files.filter((f) => f.locale === l).map((f) => f.slug))]),
  )

  // Computed unconditionally; whether a gap is an error is require_pairing's business, not ours.
  const missingTranslation = [...bySlug.entries()]
    .map(([slug, present]) => ({
      slug,
      has: present.map((p) => p.locale),
      missing: locales.filter((l) => !present.some((p) => p.locale === l)),
    }))
    .filter((entry) => entry.missing.length)

  return { locales, files, bySlug, slugsByLocale, missingTranslation }
}

/** Newest `date` across the corpus, or null when there is nothing published yet. */
export function newestDate(corpus) {
  const dates = corpus.files
    .map((f) => f.data?.date)
    .filter(Boolean)
    .sort()
  return dates.length ? dates[dates.length - 1] : null
}

/**
 * The internal-link floor for the current corpus size.
 *
 * Derived from min_internal_links_ramp alone - the old config also carried a redundant
 * min_internal_links scalar that the ramp immediately overwrote. Dormant by design: it stays 0
 * until enough posts exist for two-way linking to be realistic.
 */
export function internalLinkFloor(corpus) {
  const posts = corpus.bySlug.size
  let floor = 0
  for (const step of CONFIG.conventions.min_internal_links_ramp) {
    if (posts >= step.at_posts) floor = step.min
  }
  return floor
}
