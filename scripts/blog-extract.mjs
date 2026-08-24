#!/usr/bin/env node
/**
 * Article extraction for the devlog idea pipeline (research skill, extraction stage).
 *
 * Fetches URLs and pulls out the skeleton only - title, headings, word count, dates.
 * Deliberately does NOT store full article text: cost, and there is no reason to keep a copy
 * of someone else's writing. Outline plus counts is enough for pattern analysis.
 *
 * Usage:
 *   node scripts/blog-extract.mjs <url> [<url> ...]
 *   node scripts/blog-extract.mjs --from content/ideas/new-urls.json [--limit 20]
 *   node scripts/blog-extract.mjs --from content/ideas/discovered.json --source factorio
 *
 * Writes JSON to stdout. Redirect it, or pipe into the research skill.
 * See docs/blog-automation.md and _port/blog-pipeline-port-devlog.md.
 */
import { readFileSync } from 'node:fs'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const CONCURRENCY = 4

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, String.fromCharCode(39))
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function headings(html, level) {
  return [...html.matchAll(new RegExp('<h' + level + '[^>]*>([\\s\\S]*?)</h' + level + '>', 'gi'))]
    .map((m) => strip(m[1]))
    .filter((t) => t.length > 2 && t.length < 200)
}

function meta(html, ...names) {
  for (const name of names) {
    const m = html.match(
      new RegExp('<meta[^>]+(?:name|property)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')
    ) ??
      html.match(
        new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\']' + name + '["\']', 'i')
      )
    if (m) return strip(m[1])
  }
  return null
}

async function extract(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { url, error: 'HTTP ' + res.status }
    const html = await res.text()
    const body = strip(html)
    return {
      url,
      title: meta(html, 'og:title', 'twitter:title') ?? strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
      description: meta(html, 'description', 'og:description'),
      published: meta(html, 'article:published_time', 'datePublished', 'article:modified_time'),
      h1: headings(html, 1),
      h2: headings(html, 2),
      h3: headings(html, 3).slice(0, 25),
      word_count: body.split(' ').filter(Boolean).length,
    }
  } catch (err) {
    return { url, error: err.message }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : null
  }

  let urls
  const from = flag('--from')
  if (from) {
    const data = JSON.parse(readFileSync(from, 'utf8'))
    let posts = data.posts ?? []
    const source = flag('--source')
    if (source) posts = posts.filter((p) => p.source === source)
    const limit = flag('--limit')
    urls = posts.map((p) => p.url).slice(0, limit ? Number(limit) : undefined)
  } else {
    urls = args.filter((a) => a.startsWith('http'))
  }

  if (!urls.length) {
    console.error('no urls. pass urls directly or use --from <json>')
    process.exit(1)
  }

  const out = []
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY)
    out.push(...(await Promise.all(batch.map(extract))))
    process.stderr.write(`extracted ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}\n`)
  }
  process.stdout.write(JSON.stringify(out, null, 2))
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
