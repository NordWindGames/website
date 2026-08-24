#!/usr/bin/env node
/**
 * Conventions gate for devlog posts. Deterministic, no network, no dependencies.
 *
 * Reads src/content/blog/<locale>/*.md and checks what the blog-write skill asks a human or
 * an agent to verify "by script, not by eye": frontmatter presence, DE/EN pairing, hero image,
 * the repurposed disclosure line, and above all the internal links.
 *
 * Ported from a Next.js/next-intl repo (see docs/blog-automation.md) into Astro, adapted for
 * a personal devlog (see _port/blog-pipeline-port-devlog.md). Frontmatter *shape* is enforced
 * by the zod `.strict()` schema in src/content.config.ts (an extra/misspelled field is a build
 * error there) - this script only checks the cheap things a full `astro build` would catch too
 * slowly to be useful during a review: presence, date format, and everything the schema cannot
 * express (links, images, corpus bands).
 *
 * Locale/routing config comes from blog.config.json, not astro.config.mjs's i18n block
 * directly - keeps this script from needing to parse the Astro config file, and matches the
 * cold-start values (min_internal_links ramp, wide-open word/H2 bands) that only make sense
 * relative to this pipeline's own state, not the framework config.
 *
 *   node scripts/blog-lint.mjs             report; exit 1 on any error
 *   node scripts/blog-lint.mjs --strict    treat warnings as errors too
 *
 * See docs/blog-automation.md and _port/blog-pipeline-port-devlog.md.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const POSTS = join(ROOT, CONFIG.paths.posts_dir)
const PAGES = join(ROOT, CONFIG.paths.routes_dir)

const STRICT = process.argv.includes('--strict')

const { list: LOCALES, default: DEFAULT_LOCALE, require_pairing: REQUIRE_PAIRING } = CONFIG.locales
const CONV = CONFIG.conventions
const LEGACY_SLUGS = new Set(CONFIG.legacy_slugs ?? [])

/** Top-level routes that exist for a locale, from a plain src/pages/ directory listing. */
function appRoutes(locale) {
  const dir = locale === DEFAULT_LOCALE ? PAGES : join(PAGES, locale)
  try {
    return new Set(
      readdirSync(dir, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('['))
        .filter((d) => !(d.isDirectory() && LOCALES.includes(d.name))) // other locales' namespaces, not routes
        .map((d) => (d.isDirectory() ? d.name : d.name.replace(/\.[^.]+$/, '')))
        .filter((name) => name !== 'index')
    )
  } catch {
    return null // not verifiable - links outside /blog/ are then only warned about
  }
}

/** Minimal frontmatter reader - dependency-free, mirrors blog-index.mjs. */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: null, body: raw }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
  return { data, body: m[2] }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Tools/engines/other studios named in the text - the trigger for the disclosure line. */
function triggerTermsMentioned(body) {
  const text = body.toLowerCase()
  return (CONV.disclosure_trigger_terms ?? []).filter((term) =>
    new RegExp('(?<![a-z0-9])' + escapeRe(term.toLowerCase()) + '(?![a-z0-9])', 'i').test(text)
  )
}

const ROUTES_BY_LOCALE = new Map(LOCALES.map((l) => [l, appRoutes(l)]))
const errors = []
const warnings = []

/** A rule broken by a legacy (pre-pipeline) post is existing debt, not a new regression. */
const problem = (slug, where, message) =>
  LEGACY_SLUGS.has(slug)
    ? warnings.push(`${where}: [legacy] ${message}`)
    : errors.push(`${where}: ${message}`)
const warn = (where, message) => warnings.push(`${where}: ${message}`)

const localeDirs = existsSync(POSTS)
  ? readdirSync(POSTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

// Read everything first: the link and pairing checks need the whole corpus.
const files = []
for (const locale of localeDirs) {
  for (const file of readdirSync(join(POSTS, locale)).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(join(POSTS, locale, file), 'utf8')
    const { data, body } = splitFrontmatter(raw)
    files.push({
      locale,
      slug: file.replace(/\.md$/, ''),
      where: `${CONFIG.paths.posts_dir}/${locale}/${file}`,
      data,
      body,
      h2: [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()),
      words: body.split(/\s+/).filter(Boolean).length,
      links: [...body.matchAll(/(?<!!)\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g)].map((m) => m[2]),
    })
  }
}

const slugsByLocale = new Map(
  localeDirs.map((l) => [l, new Set(files.filter((f) => f.locale === l).map((f) => f.slug))])
)
const inbound = new Map(files.map((f) => [f.slug, new Set()]))

// Cold-start ramp (devlog port, step 6): min_internal_links stays 0 until enough posts exist
// for two-way linking to be realistic, then ramps up per blog.config.json's schedule.
const totalPosts = new Set(files.map((f) => f.slug)).size
let minInternalLinks = CONV.min_internal_links ?? 0
for (const step of CONV.min_internal_links_ramp ?? []) {
  if (totalPosts >= step.at_posts) minInternalLinks = step.min
}

for (const post of files) {
  const { where, slug, locale, data, body } = post

  // ── frontmatter ─────────────────────────────────────────────────────────────────────
  if (!data) {
    errors.push(`${where}: no frontmatter block`)
    continue
  }
  for (const field of ['title', 'description', 'date']) {
    if (!data[field]?.trim()) errors.push(`${where}: frontmatter is missing "${field}"`)
  }
  // Extra/misspelled fields are caught by the zod .strict() schema at build time
  // (src/content.config.ts) - not re-checked here, so the two cannot drift apart.
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push(`${where}: date "${data.date}" is not YYYY-MM-DD`)
  }
  if (data.title && data.title === data.description) {
    warn(where, 'description repeats the title verbatim')
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    problem(slug, where, `slug is not lowercase kebab-case - "${slug}"`)
  }

  // ── hero image right under the frontmatter ──────────────────────────────────────────
  if (CONV.require_hero_image) {
    const firstLine = body.split(/\r?\n/).find((l) => l.trim())
    if (!firstLine || !/^!\[[^\]]*\]\(/.test(firstLine.trim())) {
      problem(slug, where, 'no hero image directly under the frontmatter')
    }
  }

  // ── disclosure line (repurposed: "what I use and why", not a neutrality disclaimer) ──
  if (CONV.disclosure_trigger_terms?.length) {
    const disclosure = body.split(/\r?\n/).find((l) => new RegExp(CONV.disclosure_label_pattern, 'i').test(l))
    const trigger = triggerTermsMentioned(body)
    if (trigger.length && !disclosure) {
      problem(
        slug,
        where,
        `names ${trigger.slice(0, 4).join(', ')}${trigger.length > 4 ? ', …' : ''} but carries no ` +
          '"what I use and why" line (see disclosure_label_pattern in blog.config.json)'
      )
    }
  }

  // ── shape ───────────────────────────────────────────────────────────────────────────
  if (post.words < CONV.words.min || post.words > CONV.words.max) {
    warn(where, `${post.words} words is outside the corpus band ${CONV.words.min}-${CONV.words.max}`)
  }
  if (post.h2.length < CONV.h2.min || post.h2.length > CONV.h2.max) {
    warn(where, `${post.h2.length} H2 headings is outside the corpus band ${CONV.h2.min}-${CONV.h2.max}`)
  }

  // ── links ───────────────────────────────────────────────────────────────────────────
  const expectedPrefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
  const ROUTES = ROUTES_BY_LOCALE.get(locale)
  let internalBlogLinks = 0

  for (const href of post.links) {
    if (/^(https?:)?\/\//i.test(href)) {
      const ownDomain = escapeRe(CONFIG.brand.domain)
      if (new RegExp(`^https?://(www\\.)?${ownDomain}/`, 'i').test(href)) {
        problem(slug, where, `links to our own site absolutely - use a site-relative path: ${href}`)
      }
      continue // external links are not resolvable without network
    }
    if (/^(mailto:|tel:|#)/i.test(href)) continue
    if (!href.startsWith('/')) {
      problem(slug, where, `internal link must start with "/" - ${href}`)
      continue
    }

    const path = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
    const segments = path.split('/').filter(Boolean)
    const prefix = LOCALES.includes(segments[0]) ? `/${segments[0]}` : ''
    if (prefix !== expectedPrefix) {
      problem(
        slug,
        where,
        `wrong locale prefix for a "${locale}" post: ${href} - expected ` +
          (expectedPrefix ? `"${expectedPrefix}/…"` : 'no locale prefix ("/blog/…")') +
          (prefix ? `, not "${prefix}/…"` : ' (prefix missing)')
      )
      continue
    }

    const rest = segments.slice(prefix ? 1 : 0)
    if (rest[0] === 'blog') {
      const target = rest.slice(1).join('/')
      if (!target) continue // the blog index page
      if (!slugsByLocale.get(locale)?.has(target)) {
        problem(slug, where, `link target does not exist: ${CONFIG.paths.posts_dir}/${locale}/${target}.md`)
        continue
      }
      if (target === slug) {
        problem(slug, where, 'post links to itself')
        continue
      }
      internalBlogLinks++
      inbound.get(target)?.add(`${slug} (${locale})`)
    } else if (ROUTES && rest.length && !ROUTES.has(rest[0])) {
      problem(slug, where, `no such route: /${rest.join('/')}`)
    } else if (!ROUTES) {
      warn(where, `route not verifiable (${CONFIG.paths.routes_dir} unreadable) - ${href}`)
    }
  }

  if (internalBlogLinks < minInternalLinks) {
    problem(
      slug,
      where,
      `${internalBlogLinks} internal blog link(s), at least ${minInternalLinks} required - ` +
        'orphan posts are what this rule exists to prevent'
    )
  }
}

// ── DE/EN pairing and cross-locale consistency ────────────────────────────────────────
if (REQUIRE_PAIRING) {
  const allSlugs = [...new Set(files.map((f) => f.slug))].sort()
  for (const slug of allSlugs) {
    const present = files.filter((f) => f.slug === slug)
    const missing = localeDirs.filter((l) => !present.some((p) => p.locale === l))
    if (missing.length) {
      problem(
        slug,
        `${CONFIG.paths.posts_dir}/*/${slug}.md`,
        `missing translation: no file for locale(s) ${missing.join(', ')} - ` +
          'both locales use the identical filename'
      )
    }
    const dates = [...new Set(present.map((p) => p.data?.date).filter(Boolean))]
    if (dates.length > 1) {
      warn(`${CONFIG.paths.posts_dir}/*/${slug}.md`, `locales carry different dates: ${dates.join(' vs ')}`)
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`warn  ${w}`)
for (const e of errors) console.error(`ERROR ${e}`)

const allSlugs = [...new Set(files.map((f) => f.slug))].sort()
const orphans = allSlugs.filter((s) => inbound.get(s)?.size === 0)
console.log('\ninbound blog links per slug:')
for (const slug of allSlugs) {
  const n = inbound.get(slug)?.size ?? 0
  console.log(`  ${String(n).padStart(2)}  ${slug}${n === 0 ? '   <- orphan, nothing links here' : ''}`)
}
if (orphans.length && allSlugs.length > 1) {
  console.log(
    `\n${orphans.length} of ${allSlugs.length} slugs have no inbound link. A new post should earn ` +
      'one from an existing post, not only hand them out.'
  )
}

const failed = STRICT ? errors.length + warnings.length : errors.length
console.log(
  `\nblog-lint: ${files.length} file(s) across ${localeDirs.length} locale(s), ` +
    `${errors.length} error(s), ${warnings.length} warning(s), min_internal_links=${minInternalLinks} (${totalPosts} post(s) on disk)` +
    (STRICT ? ' - --strict, warnings count as errors' : '')
)

process.exit(failed > 0 ? 1 : 0)
