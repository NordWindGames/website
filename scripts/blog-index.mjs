#!/usr/bin/env node
/**
 * Inventory of our own blog, consumed by the research skill so it can avoid repeating a
 * topic already covered and pick internal-link targets. Deterministic, no network.
 *
 * Reads  src/content/blog/<locale>/*.md
 * Writes content/ideas/blog-index.json
 *
 * Ported from a competitor-monitoring pipeline (see docs/blog-automation.md) into a
 * personal devlog per _port/blog-pipeline-port-devlog.md.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const POSTS = join(ROOT, CONFIG.paths.posts_dir)
const OUT = join(ROOT, CONFIG.paths.ideas_dir, 'blog-index.json')

/** Minimal frontmatter reader - deliberately not gray-matter, to keep this script dependency-free. */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: raw }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
  return { data, body: m[2] }
}

const locales = existsSync(POSTS)
  ? readdirSync(POSTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

const posts = []
for (const locale of locales) {
  for (const file of readdirSync(join(POSTS, locale)).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(join(POSTS, locale, file), 'utf8')
    const { data, body } = splitFrontmatter(raw)
    const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim())
    const images = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    posts.push({
      slug: file.replace(/\.md$/, ''),
      locale,
      title: data.title ?? null,
      description: data.description ?? null,
      date: data.date ?? null,
      h2: headings,
      word_count: body.split(/\s+/).filter(Boolean).length,
      image_count: images.length,
      // Text links only - the negative lookbehind keeps image references out.
      internal_links: [...body.matchAll(/(?<!!)\[[^\]]*\]\((\/[^)]+)\)/g)]
        .map((m) => m[1])
        .filter((href) => !/\.(webp|png|jpe?g|svg|gif|avif)$/i.test(href)),
    })
  }
}

posts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.slug.localeCompare(b.slug))

const bySlug = new Map()
for (const p of posts) bySlug.set(p.slug, (bySlug.get(p.slug) ?? []).concat(p.locale))
const missingTranslation = CONFIG.locales.require_pairing
  ? [...bySlug.entries()]
      .filter(([, locs]) => locs.length < locales.length)
      .map(([slug, locs]) => ({ slug, has: locs }))
  : []

writeFileSync(
  OUT,
  JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      locales,
      unique_slugs: bySlug.size,
      total_files: posts.length,
      missing_translation: missingTranslation,
      posts,
    },
    null,
    2
  )
)

console.log(`locales: ${locales.join(', ')}`)
console.log(`unique posts: ${bySlug.size}  (${posts.length} files)`)
if (missingTranslation.length) {
  console.log('incomplete translations:')
  for (const m of missingTranslation) console.log(`  ${m.slug} -> only ${m.has.join(', ')}`)
}
for (const p of posts.filter((p) => p.locale === CONFIG.locales.default)) {
  console.log(`  ${p.date ?? '????-??-??'}  ${String(p.word_count).padStart(5)}w  ${p.h2.length} h2  ${p.slug}`)
}
console.log(`\nwrote ${CONFIG.paths.ideas_dir}/blog-index.json`)
