/**
 * Quality gates over the post corpus: conventions and images. Deterministic, no network.
 *
 * Both gates read one readCorpus() rather than walking the disk themselves, which is what used to
 * make blog-check.mjs rebuild blog-index.json first "because a stale inventory makes the link
 * checks lie". There is no inventory file to go stale any more.
 *
 * Gates deleted from the old blog-lint.mjs because they could not fire: the word band (0-20000),
 * the H2 band (0-20), the routes-dir-unreadable warning (src/pages is committed), and the whole
 * legacy_slugs branch - legacy_slugs was permanently empty by policy, which made its problem()
 * helper provably identical to errors.push(). The disclosure gate is gone too; its trigger list
 * was empty, so it short-circuited, and the requirement now lives in blog-write/SKILL.md.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG, PUBLIC_DIR, ROUTES_DIR } from './ctx.mjs'
import { internalLinkFloor } from './posts.mjs'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Routes that exist for a locale, from a *recursive* walk of the Astro pages directory.
 *
 * The old check listed only the top level and tested `rest[0]`, so `/imprint/does-not-exist`
 * passed as long as `imprint` existed. Astro's file router is a tree, so the check has to be one.
 * A dynamic segment ([slug].astro) is recorded as a `*` wildcard - it accepts any single segment
 * and nothing static can prove otherwise.
 */
function routesFor(locale) {
  const base = locale === CONFIG.locales.default ? ROUTES_DIR : join(ROUTES_DIR, locale)
  if (!existsSync(base)) return null

  const routes = new Set()
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Other locales are sibling namespaces under the default locale's root, not routes of it.
      if (prefix === '' && entry.isDirectory() && CONFIG.locales.list.includes(entry.name)) continue

      const dynamic = entry.name.startsWith('[')
      if (entry.isDirectory()) {
        const path = `${prefix}${dynamic ? '*' : entry.name}`
        routes.add(path)
        walk(join(dir, entry.name), `${path}/`)
        continue
      }
      if (!/\.(astro|md|mdx|html)$/i.test(entry.name)) continue

      const stem = entry.name.replace(/\.[^.]+$/, '')
      if (stem === 'index') continue // the containing directory already covers it
      routes.add(`${prefix}${dynamic ? '*' : stem}`)
    }
  }
  walk(base, '')
  return routes
}

/** Does a path exist as a route, or as a real file under public/ (favicon, PDF, CNAME)? */
function resolves(routes, segments) {
  if (routes.has(segments.join('/'))) return true
  for (let i = 0; i < segments.length; i++) {
    if (routes.has([...segments.slice(0, i), '*'].join('/'))) return true
  }
  return existsSync(join(PUBLIC_DIR, ...segments))
}

/**
 * existsSync() is case-insensitive on Windows and macOS, but the site is served from Linux
 * (GitHub Pages). A post referencing "step1_adresse.webp" for a file named "step1_Adresse.webp"
 * renders fine locally and 404s in production. Walk segment by segment and compare exactly.
 */
function existsCaseExact(src) {
  let dir = PUBLIC_DIR
  for (const segment of src.replace(/^\//, '').split('/')) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return false
    }
    if (!entries.includes(segment)) return false
    dir = join(dir, segment)
  }
  return true
}

/** Intrinsic pixel size of an SVG, viewBox first. */
function svgSize(markup) {
  const tag = markup.match(/<svg\b[^>]*>/i)?.[0]
  if (!tag) return null

  const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (viewBox) {
    const p = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) {
      return { width: p[2], height: p[3] }
    }
  }

  const width = Number(tag.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1])
  const height = Number(tag.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1])
  return width > 0 && height > 0 ? { width, height } : null
}

/** Conventions: frontmatter, slug, hero image, internal links, DE/EN pairing. */
export function lint(corpus) {
  const errors = []
  const warnings = []
  const err = (where, message) => errors.push(`${where}: ${message}`)
  const warn = (where, message) => warnings.push(`${where}: ${message}`)

  const { list: LOCALES, default: DEFAULT_LOCALE, require_pairing } = CONFIG.locales
  const routesByLocale = new Map(LOCALES.map((l) => [l, routesFor(l)]))
  const floor = internalLinkFloor(corpus)
  const inbound = new Map([...corpus.bySlug.keys()].map((slug) => [slug, new Set()]))

  for (const post of corpus.files) {
    const { where, slug, locale, data, body } = post

    if (!data) {
      err(where, 'no frontmatter block')
      continue
    }
    for (const field of ['title', 'description', 'date']) {
      if (!data[field]?.trim()) err(where, `frontmatter is missing "${field}"`)
    }
    // Astro parses the block as real YAML, this reader does not. Catch the gap rather than
    // letting a green gate hand a build error to the next person.
    for (const { key, value } of post.yamlRisks ?? []) {
      err(
        where,
        `frontmatter "${key}" contains ": " but is not quoted, so YAML reads it as a nested ` +
          `key and the build fails. Wrap it in double quotes: ${key}: "${value}"`,
      )
    }
    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      err(where, `date "${data.date}" is not YYYY-MM-DD`)
    }
    if (data.title && data.title === data.description) {
      warn(where, 'description repeats the title verbatim')
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      err(where, `slug is not lowercase kebab-case - "${slug}"`)
    }

    if (CONFIG.conventions.require_hero_image) {
      const first = body.split(/\r?\n/).find((l) => l.trim())
      if (!first || !/^!\[[^\]]*\]\(/.test(first.trim())) {
        err(where, 'no hero image directly under the frontmatter')
      }
    }

    const expectedPrefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
    const routes = routesByLocale.get(locale)
    let internalBlogLinks = 0

    for (const href of post.links) {
      if (/^(https?:)?\/\//i.test(href)) {
        const domain = escapeRe(CONFIG.brand.domain)
        if (domain && new RegExp(`^https?://(www\\.)?${domain}/`, 'i').test(href)) {
          err(where, `links to our own site absolutely - use a site-relative path: ${href}`)
        }
        continue // external links are not resolvable without network
      }
      if (/^(mailto:|tel:|#)/i.test(href)) continue
      if (!href.startsWith('/')) {
        err(where, `internal link must start with "/" - ${href}`)
        continue
      }

      const path = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
      const segments = path.split('/').filter(Boolean)
      const prefix = LOCALES.includes(segments[0]) ? `/${segments[0]}` : ''

      if (prefix !== expectedPrefix) {
        err(
          where,
          `wrong locale prefix for a "${locale}" post: ${href} - expected ` +
            (expectedPrefix ? `"${expectedPrefix}/…"` : 'no locale prefix ("/blog/…")') +
            (prefix ? `, not "${prefix}/…"` : ' (prefix missing)'),
        )
        continue
      }

      const rest = segments.slice(prefix ? 1 : 0)
      if (rest[0] === 'blog') {
        const target = rest.slice(1).join('/')
        if (!target) continue // the blog index page
        if (!corpus.slugsByLocale.get(locale)?.has(target)) {
          err(where, `link target does not exist: ${CONFIG.paths.posts_dir}/${locale}/${target}.md`)
          continue
        }
        if (target === slug) {
          err(where, 'post links to itself')
          continue
        }
        internalBlogLinks++
        inbound.get(target)?.add(`${slug} (${locale})`)
      } else if (routes && rest.length && !resolves(routes, rest)) {
        err(where, `no such route: /${rest.join('/')}`)
      }
    }

    if (internalBlogLinks < floor) {
      err(
        where,
        `${internalBlogLinks} internal blog link(s), at least ${floor} required - ` +
          'orphan posts are what this rule exists to prevent',
      )
    }
  }

  if (require_pairing) {
    for (const { slug, missing } of corpus.missingTranslation) {
      err(
        `${CONFIG.paths.posts_dir}/*/${slug}.md`,
        `missing translation: no file for locale(s) ${missing.join(', ')} - ` +
          'both locales use the identical filename',
      )
    }
    for (const [slug, present] of corpus.bySlug) {
      const dates = [...new Set(present.map((p) => p.data?.date).filter(Boolean))]
      if (dates.length > 1) {
        warn(
          `${CONFIG.paths.posts_dir}/*/${slug}.md`,
          `locales carry different dates: ${dates.join(' vs ')}`,
        )
      }
    }
  }

  return { errors, warnings, inbound, floor }
}

/** Images: path shape, existence, case-exactness, alt text, SVG scalability. */
export function assets(corpus) {
  const errors = []
  const warnings = []
  let checked = 0

  for (const post of corpus.files) {
    for (const { alt, src } of post.images) {
      checked++
      const where = post.where

      if (/^https?:\/\//i.test(src)) {
        warnings.push(`${where}: remote image, not checked - ${src}`)
        continue
      }
      if (!src.startsWith('/')) {
        errors.push(
          `${where}: image path must start with "/" (served from ${CONFIG.paths.public_dir}/) - ${src}`,
        )
        continue
      }

      const file = join(PUBLIC_DIR, src.replace(/^\//, ''))
      if (!existsSync(file)) {
        errors.push(`${where}: image does not exist - ${CONFIG.paths.public_dir}${src}`)
        continue
      }
      if (!existsCaseExact(src)) {
        errors.push(
          `${where}: image path differs in case from the file on disk, which 404s on Linux - ` +
            `${CONFIG.paths.public_dir}${src}`,
        )
        continue
      }

      // Deliberately an error, not a warning: there is no case where shipping an image with no
      // alt text is intended, and the corpus was empty when this was tightened.
      if (!alt.trim()) errors.push(`${where}: image has no alt text - ${src}`)

      if (!src.toLowerCase().endsWith('.svg')) continue

      const size = svgSize(readFileSync(file, 'utf8'))
      if (!size) {
        errors.push(
          `${where}: SVG has no readable viewBox, so it does not scale responsively inside the ` +
            `fluid content column - ${CONFIG.paths.public_dir}${src}. Add viewBox="0 0 <w> <h>".`,
        )
        continue
      }

      const ratio = size.width / size.height
      const { min, max } = CONFIG.assets.svg_ratio
      if (ratio < min || ratio > max) {
        warnings.push(
          `${where}: SVG aspect ratio ${ratio.toFixed(2)}:1 (${size.width}x${size.height}) is ` +
            `unusual for the ${CONFIG.assets.prose_width_px}px-wide prose column - ` +
            `${CONFIG.paths.public_dir}${src}`,
        )
      }
    }
  }

  return { errors, warnings, checked }
}

/**
 * Corpus distribution, printed instead of enforced.
 *
 * The old config carried a word band of 0-20000 and an H2 band of 0-20 - placeholders that could
 * not fire but read like rules. Showing the actual spread puts the numbers you would need to set a
 * real band in front of you at the moment it becomes relevant.
 */
export function distribution(corpus) {
  if (!corpus.files.length) return null

  const spread = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return {
      min: sorted[0],
      median: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
      max: sorted[sorted.length - 1],
    }
  }

  return {
    words: spread(corpus.files.map((f) => f.words)),
    h2: spread(corpus.files.map((f) => f.h2.length)),
  }
}
