#!/usr/bin/env node
/**
 * Ingestion layer for the devlog idea pipeline (research skill, discovery stage).
 *
 * Deterministic only: fetch, parse, dedupe, persist. No LLM calls, no judgement.
 * The reasoning half (extraction, theme clustering, scoring) is done by Claude Code on top
 * of this script's output. See docs/blog-automation.md and _port/blog-pipeline-port-devlog.md.
 *
 * Reads content/ideas/sources.local.json (gitignored - the real reference-blog URLs never
 * land in this public repo; see .gitignore and content/ideas/sources.example.json for the
 * shape). Falls back to sources.example.json only to report that the local file is missing.
 *
 * Modes:
 *   --probe      connectivity + user-agent report per source, writes nothing
 *   --baseline   discover everything, write discovered.json, leave seen.json alone
 *   --delta      discover, diff against seen.json, write new-urls.json, update seen.json
 *   --seed       mark every discovered URL as seen (run once after the baseline analysis)
 *
 * Exit codes: 0 clean, 1 crashed, 2 discovery ran but at least one source came in under its
 * expected_min. A 2 still writes its artefacts - the URLs found are good, the coverage is not -
 * and records the failure inside them, so the periodic briefing and the SessionStart nudge can
 * report it. A silently broken source looks exactly like a quiet period, which is the failure
 * mode this exists to prevent. To retire a source deliberately set "enabled": false on it in
 * sources.local.json; never lower expected_min to make a FAIL go away.
 *
 * A source's discovery method is one of "sitemap", "html" or "rss". A source can also carry
 * "baseline_endpoint": { method, endpoints, expected_min } to use a different (usually deeper,
 * un-truncated) source only for --baseline/--seed, when its primary feed is truncated to the
 * most recent entries. See _port/blog-pipeline-port-devlog.md section 2.2.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const IDEAS = join(ROOT, CONFIG.paths.ideas_dir)
const SOURCES_FILE = join(IDEAS, 'sources.local.json')

const TIMEOUT_MS = 25_000
const SITEMAP_MAX_DEPTH = 3

const UA_PROFILES = {
  browser: {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,de;q=0.8',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  },
  default: {
    'user-agent': CONFIG.brand.user_agent,
    accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
  },
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, String.fromCharCode(39))
    .trim()

async function get(url, uaProfile) {
  try {
    const res = await fetch(url, {
      headers: UA_PROFILES[uaProfile] ?? UA_PROFILES.default,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = res.ok ? await res.text() : ''
    return { ok: res.ok, status: res.status, finalUrl: res.url, body }
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, body: '', error: err.message }
  }
}

function innerTag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'))
  return m ? decode(m[1]) : null
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'))
  return m ? decode(m[1]) : null
}

/** Returns { entries: [{loc, lastmod}], children: [sitemapUrl] } */
function parseSitemap(xml) {
  const isIndex = /<sitemapindex/i.test(xml)
  const pattern = isIndex ? /<sitemap[\s>][\s\S]*?<\/sitemap>/gi : /<url[\s>][\s\S]*?<\/url>/gi
  const blocks = xml.match(pattern) ?? []
  const parsed = blocks
    .map((b) => ({ loc: innerTag(b, 'loc'), lastmod: innerTag(b, 'lastmod') }))
    .filter((e) => e.loc)
  return isIndex
    ? { entries: [], children: parsed.map((e) => e.loc) }
    : { entries: parsed, children: [] }
}

async function collectSitemap(url, uaProfile, depth = 0, acc = [], log = []) {
  const res = await get(url, uaProfile)
  log.push({ url, status: res.status, error: res.error })
  if (!res.ok) return { entries: acc, log }
  if (!/<(urlset|sitemapindex)/i.test(res.body)) {
    log.push({ url, status: res.status, error: 'not XML (HTML or soft-404 returned)' })
    return { entries: acc, log }
  }
  const { entries, children } = parseSitemap(res.body)
  acc.push(...entries)
  if (depth < SITEMAP_MAX_DEPTH) {
    for (const child of children) await collectSitemap(child, uaProfile, depth + 1, acc, log)
  }
  return { entries: acc, log }
}

async function collectHtml(url, uaProfile) {
  const res = await get(url, uaProfile)
  const log = [{ url, status: res.status, error: res.error }]
  if (!res.ok) return { entries: [], log }
  const hrefs = [...res.body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => decode(m[1]))
  const entries = []
  const seen = new Set()
  for (const href of hrefs) {
    let abs
    try {
      abs = new URL(href, res.finalUrl).toString()
    } catch {
      continue
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    entries.push({ loc: abs, lastmod: null })
  }
  return { entries, log }
}

/**
 * Parses RSS 2.0 <item> and Atom <entry> blocks into the same {loc, lastmod} shape
 * collectSitemap/collectHtml return, so nothing downstream needs to know a feed was used.
 * A devlog almost always publishes a feed, and it is a better discovery source than a
 * sitemap or HTML listing: stable, dated, and meant for exactly this. See
 * _port/blog-pipeline-port-devlog.md section 2.2. One caveat handled by the caller, not
 * here: most feeds carry only the most recent 10-20 entries, which is fine for --delta and
 * wrong for --baseline (see "baseline_endpoint" in sources.local.json).
 */
function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)
  const pattern = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi
  const blocks = xml.match(pattern) ?? []
  const entries = blocks
    .map((b) => {
      let loc
      if (isAtom) {
        const linkTag =
          b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i)?.[0] ?? b.match(/<link\b[^>]*>/i)?.[0]
        loc = linkTag ? attr(linkTag, 'href') : innerTag(b, 'link')
      } else {
        loc = innerTag(b, 'link')
      }
      const lastmod = innerTag(b, 'pubDate') ?? innerTag(b, 'updated') ?? innerTag(b, 'published')
      return { loc, lastmod }
    })
    .filter((e) => e.loc)
  return { entries }
}

async function collectRss(url, uaProfile) {
  const res = await get(url, uaProfile)
  const log = [{ url, status: res.status, error: res.error }]
  if (!res.ok) return { entries: [], log }
  if (!/<(rss[\s>]|feed[\s>])/i.test(res.body)) {
    log.push({ url, status: res.status, error: 'not an RSS/Atom feed (HTML or soft-404 returned)' })
    return { entries: [], log }
  }
  return { entries: parseFeed(res.body).entries, log }
}

/** When a filter matches nothing, show what path shapes were actually available. */
function prefixHistogram(entries, host) {
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
    const key = '/' + (seg[0] ?? '') + (seg.length > 1 ? '/*' : '')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
}

async function collect(method, endpoint, ua) {
  if (method === 'html') return collectHtml(endpoint, ua)
  if (method === 'rss') return collectRss(endpoint, ua)
  return collectSitemap(endpoint, ua)
}

async function discover(source, mode) {
  // --baseline / --seed use baseline_endpoint (usually deeper, un-truncated) when the
  // source declares one; --probe / --delta always use the primary (usually feed) endpoint.
  const useBaseline = (mode === '--baseline' || mode === '--seed') && source.baseline_endpoint
  const effective = useBaseline
    ? { ...source, ...source.baseline_endpoint }
    : source
  const expectedMin = useBaseline && source.baseline_endpoint.expected_min != null
    ? source.baseline_endpoint.expected_min
    : source.expected_min

  const filter = new RegExp(effective.pathFilter)
  const exclude = effective.excludePattern ? new RegExp(effective.excludePattern) : null
  const host = new URL(source.site).host
  const attempts = []
  let raw = []

  for (const endpoint of effective.endpoints) {
    const { entries, log } = await collect(effective.method, endpoint, effective.ua ?? source.ua)
    attempts.push(...log)
    if (entries.length) {
      raw = entries
      break
    }
  }

  const byUrl = new Map()
  for (const e of raw) {
    let u
    try {
      u = new URL(e.loc)
    } catch {
      continue
    }
    if (u.host !== host) continue
    if (!filter.test(u.pathname)) continue
    if (exclude && exclude.test(u.pathname)) continue
    const key = u.origin + u.pathname.replace(/\/$/, '')
    if (!byUrl.has(key)) byUrl.set(key, { url: key, lastmod: e.lastmod, source: source.id })
  }

  return {
    id: source.id,
    tier: source.tier,
    expectedMin,
    attempts,
    rawCount: raw.length,
    posts: [...byUrl.values()],
    hint: byUrl.size === 0 && raw.length > 0 ? prefixHistogram(raw, host) : null,
  }
}

async function probe(sources) {
  console.log('\n=== PROBE: endpoint reachability per user-agent profile ===\n')
  for (const s of sources) {
    const endpointSets = [{ label: '', method: s.method, endpoints: s.endpoints, ua: s.ua }]
    if (s.baseline_endpoint) {
      endpointSets.push({ label: ' (baseline)', ...s.baseline_endpoint, ua: s.baseline_endpoint.ua ?? s.ua })
    }
    for (const set of endpointSets) {
      for (const endpoint of set.endpoints) {
        const row = []
        for (const profile of ['default', 'browser']) {
          const res = await get(endpoint, profile)
          const kind = res.ok ? (/<(urlset|sitemapindex|rss|feed)/i.test(res.body) ? 'xml' : 'html') : '-'
          row.push(profile + '=' + (res.status || res.error) + (res.ok ? '/' + kind : ''))
        }
        console.log((s.id + set.label).padEnd(20) + ' ' + row.join('  ') + '   ' + endpoint)
      }
    }
  }
  console.log('\n403 for both profiles -> genuinely blocked, keep tier C.')
  console.log('403 for default but 200 for browser -> set "ua": "browser", promote to tier A.\n')
}

async function main() {
  const args = process.argv.slice(2)
  const mode = ['--probe', '--baseline', '--delta', '--seed'].find((m) => args.includes(m)) ?? '--probe'

  if (!existsSync(SOURCES_FILE)) {
    console.error(
      `${CONFIG.paths.ideas_dir}/sources.local.json does not exist. This file holds the real ` +
        'reference-blog URLs and is gitignored on purpose (see .gitignore and ' +
        'sources.example.json for the shape) - copy the example and fill in real sources.'
    )
    process.exit(1)
  }
  const config = JSON.parse(readFileSync(SOURCES_FILE, 'utf8'))

  if (mode === '--probe') return probe(config.sources)

  // A source can be retired on purpose. That is not a failure, but it stays visible.
  const active = config.sources.filter((s) => s.enabled !== false)
  const retired = config.sources.filter((s) => s.enabled === false)

  const results = []
  for (const source of active) results.push(await discover(source, mode))

  console.log('\n=== DISCOVERY (' + mode + ') ===\n')
  const failed = []
  let total = 0
  for (const r of results) {
    const ok = r.posts.length >= r.expectedMin
    if (!ok) failed.push({ id: r.id, found: r.posts.length, expected_min: r.expectedMin })
    total += r.posts.length
    console.log(
      (ok ? 'OK  ' : 'FAIL') +
        ' ' +
        r.id.padEnd(15) +
        ' tier ' +
        r.tier +
        '  ' +
        String(r.posts.length).padStart(3) +
        ' posts (expected >= ' +
        r.expectedMin +
        ', ' +
        r.rawCount +
        ' raw urls seen)'
    )
    for (const a of r.attempts.filter((a) => a.error || a.status >= 400)) {
      console.log('       ! ' + (a.status || '') + ' ' + (a.error ?? '') + ' ' + a.url)
    }
    if (r.hint) {
      const src = config.sources.find((s) => s.id === r.id)
      console.log('       pathFilter "' + src.pathFilter + '" matched nothing. Available path shapes:')
      for (const [prefix, n] of r.hint) console.log('         ' + String(n).padStart(4) + '  ' + prefix)
    }
  }
  for (const s of retired) {
    console.log('SKIP ' + s.id.padEnd(15) + ' disabled in sources.local.json' + (s.notes ? ' - ' + s.notes.slice(0, 60) : ''))
  }
  console.log('\ntotal discovered: ' + total)

  // The report above scrolls past; this is what the rest of the pipeline reads.
  if (failed.length === results.length && results.length > 0) {
    console.log(
      '\nEVERY source came in short. That points at this machine, not at every reference blog ' +
        'redesigning its site on the same day - check the network and rerun.'
    )
  } else if (failed.length) {
    console.log(
      '\nINCOMPLETE: ' +
        failed.map((f) => f.id + ' ' + f.found + '/' + f.expected_min).join(', ') +
        '\nA source under its expected_min changed its structure. Inspect it with --probe and fix' +
        '\nsources.local.json. Do NOT lower expected_min, and do not read this run as a quiet period.'
    )
  }

  const complete = failed.length === 0
  const discovered = results.flatMap((r) => r.posts)
  const seenFile = JSON.parse(readFileSync(join(IDEAS, 'seen.json'), 'utf8'))
  const stamp = new Date().toISOString().slice(0, 10)

  if (mode === '--baseline') {
    writeFileSync(
      join(IDEAS, 'discovered.json'),
      JSON.stringify(
        {
          generated: stamp,
          mode: 'baseline',
          complete,
          sources_failed: failed,
          count: discovered.length,
          posts: discovered,
        },
        null,
        2
      )
    )
    const unseen = discovered.filter((p) => !seenFile.seen[p.url]).length
    console.log(
      `wrote ${CONFIG.paths.ideas_dir}/discovered.json (` + discovered.length + ' posts, ' + unseen + ' not yet in seen.json)'
    )
    console.log('next: run the baseline pattern analysis, then --seed to stop re-reporting these.')
    return complete ? 0 : 2
  }

  if (mode === '--seed') {
    for (const p of discovered) {
      seenFile.seen[p.url] = { first_seen: stamp, lastmod: p.lastmod, source: p.source }
    }
    writeFileSync(join(IDEAS, 'seen.json'), JSON.stringify(seenFile, null, 2))
    console.log('seeded ' + discovered.length + ' urls into seen.json')
    if (!complete) {
      console.log('note: seeded from an incomplete discovery - the short source will resurface as new.')
    }
    return complete ? 0 : 2
  }

  // --delta
  const fresh = discovered.filter((p) => !seenFile.seen[p.url])
  for (const p of fresh) {
    seenFile.seen[p.url] = { first_seen: stamp, lastmod: p.lastmod, source: p.source }
  }
  writeFileSync(join(IDEAS, 'seen.json'), JSON.stringify(seenFile, null, 2))
  writeFileSync(
    join(IDEAS, 'new-urls.json'),
    JSON.stringify(
      {
        generated: stamp,
        mode: 'delta',
        // `complete: false` marks this run as not counting for the due-check: a run that
        // missed a source must not silence the nudge for another cadence_days.
        complete,
        sources_failed: failed,
        count: fresh.length,
        posts: fresh,
      },
      null,
      2
    )
  )
  console.log('\n' + fresh.length + ' new urls -> ' + CONFIG.paths.ideas_dir + '/new-urls.json')
  return complete ? 0 : 2
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
