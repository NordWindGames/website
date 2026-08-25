/**
 * Parsers for discovery and extraction: sitemaps, RSS/Atom feeds, HTML listings, article shape.
 *
 * All discovery parsers return the same `{loc, lastmod}` shape, so nothing downstream needs to
 * know which method a source used.
 *
 * The old code carried two forked entity decoders - a 5-case `decode()` in the crawler and a
 * 12-case `strip()` in the extractor whose final `.replace(/&[a-z]+;/gi, ' ')` turned every
 * unhandled entity into a space *after* handling five by name. One real decoder replaces both.
 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…',
}

export const decodeEntities = (s) =>
  String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code = /^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return ENTITIES[ref.toLowerCase()] ?? match
  })

/** Visible text of an HTML document, with scripts, styles and inline SVG removed. */
export const stripTags = (html) =>
  decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()

const innerTag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decodeEntities(m[1]).trim() : null
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return m ? decodeEntities(m[1]).trim() : null
}

/**
 * Sitemap or sitemap index. Returns `{entries, children}`; a caller that does not follow
 * `children` simply sees an index as empty, which is the honest outcome.
 */
export function parseSitemap(xml) {
  const isIndex = /<sitemapindex/i.test(xml)
  const blocks = xml.match(isIndex ? /<sitemap[\s>][\s\S]*?<\/sitemap>/gi : /<url[\s>][\s\S]*?<\/url>/gi) ?? []
  const parsed = blocks
    .map((b) => ({ loc: innerTag(b, 'loc'), lastmod: innerTag(b, 'lastmod') }))
    .filter((e) => e.loc)

  return isIndex ? { entries: [], children: parsed.map((e) => e.loc) } : { entries: parsed, children: [] }
}

/**
 * RSS 2.0 `<item>` and Atom `<entry>` into the same shape.
 *
 * A devlog almost always publishes a feed, and it is a better discovery source than a sitemap or
 * an HTML listing: stable, dated, and meant for exactly this. The caveat is the caller's: most
 * feeds carry only the 10-20 most recent entries, which is right for a delta and wrong for a
 * baseline - hence `baseline_endpoint` in sources.local.json.
 */
export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []

  return blocks
    .map((block) => {
      let loc
      if (isAtom) {
        const link =
          block.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i)?.[0] ?? block.match(/<link\b[^>]*>/i)?.[0]
        loc = link ? attr(link, 'href') : innerTag(block, 'link')
      } else {
        loc = innerTag(block, 'link')
      }
      const lastmod =
        innerTag(block, 'pubDate') ?? innerTag(block, 'updated') ?? innerTag(block, 'published')
      return { loc, lastmod }
    })
    .filter((e) => e.loc)
}

/** Every href on an HTML listing page, absolutised against the URL actually served. */
export function parseLinks(html, baseUrl) {
  const seen = new Set()
  const entries = []

  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let abs
    try {
      abs = new URL(decodeEntities(m[1]), baseUrl).toString()
    } catch {
      continue
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    entries.push({ loc: abs, lastmod: null })
  }
  return entries
}

/** When a pathFilter matches nothing, show which path shapes were actually on offer. */
export function prefixHistogram(entries, host) {
  const counts = new Map()
  for (const e of entries) {
    let u
    try {
      u = new URL(e.loc)
    } catch {
      continue
    }
    if (host && u.host !== host) continue
    const seg = u.pathname.split('/').filter(Boolean)
    const key = `/${seg[0] ?? ''}${seg.length > 1 ? '/*' : ''}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
}

const headings = (html, level) =>
  [...html.matchAll(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'gi'))]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 2 && t.length < 200)

const meta = (html, ...names) => {
  for (const name of names) {
    const m =
      html.match(
        new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
      ) ??
      html.match(
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i')
      )
    if (m) return stripTags(m[1])
  }
  return null
}

/**
 * The shape of an article: title, date, heading outline, length.
 *
 * Deliberately never the full text. Outline plus counts is enough to learn how a devlog is
 * structured, and storing other people's articles in this repo is not something to start doing.
 */
export function articleSkeleton(html) {
  return {
    title:
      meta(html, 'og:title', 'twitter:title') ??
      stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    description: meta(html, 'description', 'og:description'),
    published: meta(html, 'article:published_time', 'datePublished', 'article:modified_time'),
    h1: headings(html, 1),
    h2: headings(html, 2),
    h3: headings(html, 3).slice(0, 25),
    // /\s+/, not ' ' - the old extractor split on a single space and counted every
    // newline-separated word as one, so its word_count was not comparable to the corpus reader's.
    word_count: stripTags(html).split(/\s+/).filter(Boolean).length,
  }
}
