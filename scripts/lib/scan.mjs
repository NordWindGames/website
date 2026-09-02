/**
 * One scan: reference blogs, our own git activity, our own post inventory - into one snapshot.
 *
 * Replaces blog-sources.mjs (discovery), blog-index.mjs (inventory), blog-extract.mjs (article
 * shape) and blog-weekly.mjs's run() (orchestration). Those four ran as three sequential child
 * processes, and the two that need no network sat behind the one that does.
 *
 * Sources are fetched concurrently - they are independent hosts and discovery shares no state -
 * and the local work runs alongside them.
 *
 * The invariant worth stating: a silently broken source must never look like a quiet week. Every
 * source declares an `expected_min`; coming in under it is a FAIL that sets `complete: false` and
 * a non-zero exit, and that check applies to a cached 304 exactly as it does to a fresh fetch.
 */
import { CONFIG, IDEAS, daysSince, readIdeas, rel, today, writeIdeas } from './ctx.mjs'
import { readActivity } from './git.mjs'
import { fetchText, pool } from './http.mjs'
import { articleSkeleton, parseFeed, parseLinks, parseSitemap, prefixHistogram } from './parse.mjs'
import { newestDate, readCorpus } from './posts.mjs'

const EMPTY_STATE = { schema_version: 2, last_scan: null, endpoints: {}, seen: {} }

/**
 * Load state.json, migrating the old seen.json on first run.
 *
 * The old file stored `{url: {first_seen, lastmod, source}}` pretty-printed, which made 327 URLs
 * into 63 KB - mostly indentation and a lastmod field nothing read back. One string per URL and no
 * indent is the same information at a quarter of the size, and it leaves seen.json untouched so
 * the old scripts keep working until they are deleted.
 */
export function loadState() {
  const state = readIdeas('state.json')
  if (state) return { ...EMPTY_STATE, ...state }

  const legacy = readIdeas('seen.json')
  if (!legacy?.seen) return { ...EMPTY_STATE }

  const seen = {}
  for (const [url, entry] of Object.entries(legacy.seen)) {
    seen[url] = `${entry.source ?? '?'}:${entry.first_seen ?? ''}`
  }
  return { ...EMPTY_STATE, seen, migrated_from: 'seen.json' }
}

function parseBody(method, res) {
  if (method === 'rss') {
    if (!/<(rss[\s>]|feed[\s>])/i.test(res.body)) {
      return { entries: [], note: 'not an RSS/Atom feed (HTML or soft-404 returned)' }
    }
    return { entries: parseFeed(res.body) }
  }
  if (method === 'html') {
    return { entries: parseLinks(res.body, res.finalUrl) }
  }
  if (!/<(urlset|sitemapindex)/i.test(res.body)) {
    return { entries: [], note: 'not XML (HTML or soft-404 returned)' }
  }
  const { entries, children } = parseSitemap(res.body)
  return {
    entries,
    // Sitemap indexes are not followed. Saying so beats reporting an empty source.
    note: children.length
      ? `sitemap index: ${children.length} child sitemap(s) not followed`
      : null,
  }
}

/** Discover one source. Never throws; a failure comes back as a result with `found: 0`. */
async function discover(source, { mode, state, revalidateBefore }) {
  const useBaseline = (mode === 'full' || mode === 'seed') && source.baseline_endpoint
  const effective = useBaseline ? { ...source, ...source.baseline_endpoint } : source
  const expectedMin =
    useBaseline && source.baseline_endpoint.expected_min != null
      ? source.baseline_endpoint.expected_min
      : source.expected_min

  const host = new URL(source.site).host
  const filter = new RegExp(effective.pathFilter)
  const attempts = []

  let entries = []
  let cached = false
  let validators = null
  let endpointUsed = null

  for (const endpoint of effective.endpoints) {
    const prev = state.endpoints[endpoint]
    // A baseline always refetches. Otherwise stored validators expire, so a server that answers
    // 304 forever cannot hide a change indefinitely.
    const stale = !prev?.full_fetch || prev.full_fetch < revalidateBefore
    const conditional = mode !== 'full' && mode !== 'seed' && !stale ? prev : null

    const res = await fetchText(endpoint, {
      ua: effective.ua ?? source.ua ?? 'default',
      userAgent: CONFIG.brand.user_agent,
      validators: conditional,
    })
    attempts.push({ url: endpoint, status: res.status, error: res.error ?? null })

    if (res.unchanged) {
      cached = true
      endpointUsed = endpoint
      validators = prev
      break
    }
    if (!res.ok) continue

    const parsed = parseBody(effective.method, res)
    if (parsed.note) attempts.push({ url: endpoint, status: res.status, error: parsed.note })
    if (!parsed.entries.length) continue

    entries = parsed.entries
    endpointUsed = endpoint
    validators = {
      etag: res.etag ?? null,
      last_modified: res.last_modified ?? null,
      full_fetch: today(),
    }
    break
  }

  const byUrl = new Map()
  for (const entry of entries) {
    let u
    try {
      u = new URL(entry.loc)
    } catch {
      continue
    }
    if (u.host !== host) continue
    if (!filter.test(u.pathname)) continue
    const key = u.origin + u.pathname.replace(/\/$/, '')
    if (!byUrl.has(key)) byUrl.set(key, { url: key, lastmod: entry.lastmod, source: source.id })
  }

  // A 304 carries no body, so the count that decides pass/fail is the one from the last real
  // fetch. Exempting cached sources from expected_min is exactly the masking this guards against.
  const found = cached ? (validators?.found ?? 0) : byUrl.size

  return {
    id: source.id,
    endpoint: endpointUsed,
    expected_min: expectedMin ?? 0,
    found,
    cached,
    ok: found >= (expectedMin ?? 0),
    attempts,
    posts: [...byUrl.values()],
    validators: validators ? { ...validators, found } : null,
    hint: !cached && byUrl.size === 0 && entries.length ? prefixHistogram(entries, host) : null,
  }
}

/** Reachability matrix: every endpoint against both UA profiles, all at once. */
export async function probe(sources) {
  const jobs = []
  for (const source of sources) {
    const sets = [{ label: 'primary', endpoints: source.endpoints }]
    if (source.baseline_endpoint) {
      sets.push({ label: 'baseline', endpoints: source.baseline_endpoint.endpoints })
    }
    for (const set of sets) {
      for (const endpoint of set.endpoints ?? []) {
        for (const ua of ['default', 'browser']) {
          jobs.push({ id: source.id, label: set.label, endpoint, ua })
        }
      }
    }
  }

  const results = await pool(
    jobs,
    async (job) => {
      const res = await fetchText(job.endpoint, { ua: job.ua, userAgent: CONFIG.brand.user_agent })
      return { ...job, status: res.status, error: res.error ?? null, bytes: res.body.length }
    },
    { hostOf: (job) => new URL(job.endpoint).host },
  )

  return results.sort((a, b) => a.id.localeCompare(b.id) || a.endpoint.localeCompare(b.endpoint))
}

/**
 * Run a scan.
 *
 * `mode` is 'delta' (default), 'full' (baseline, seeds `seen` without extracting) or 'seed'
 * (baseline, records everything as already seen so the next delta is quiet).
 */
export async function scan({ mode = 'delta', extract = 20, refs = true } = {}) {
  const sourcesFile = readIdeas('sources.local.json')
  const state = loadState()
  const revalidateBefore = new Date(Date.now() - CONFIG.cadence_days * 86_400_000)
    .toISOString()
    .slice(0, 10)

  // Local work does not wait on the network any more.
  const localWork = (async () => {
    const corpus = readCorpus()
    const activity = await readActivity(newestDate(corpus))
    return { corpus, activity }
  })()

  // A missing sources file is not "no new posts" - it is a scan that could not look. Reporting
  // that as complete is the same failure the expected_min guard exists to prevent.
  const sourcesMissing = refs && !sourcesFile
  const active = refs ? (sourcesFile?.sources ?? []).filter((s) => s.enabled !== false) : []
  const discovered = await Promise.all(
    active.map((source) => discover(source, { mode, state, revalidateBefore })),
  )
  // Collected first, then sorted: in parallel, four sources' logs would otherwise interleave.
  discovered.sort((a, b) => a.id.localeCompare(b.id))

  const { corpus, activity } = await localWork

  const fresh = []
  for (const source of discovered) {
    for (const post of source.posts) {
      if (state.seen[post.url]) continue
      fresh.push(post)
    }
  }
  fresh.sort((a, b) => String(b.lastmod ?? '').localeCompare(String(a.lastmod ?? '')))

  // A baseline exists to seed `seen`, not to be read - extracting 282 URLs would be pointless.
  const wantExtract = mode === 'delta' && extract > 0 ? fresh.slice(0, extract) : []
  const skippedExtract =
    mode === 'delta' ? Math.max(0, fresh.length - wantExtract.length) : fresh.length

  const extracted = await pool(
    wantExtract.map((p) => p.url),
    async (url) => {
      const res = await fetchText(url, { ua: 'browser', userAgent: CONFIG.brand.user_agent })
      if (!res.ok) return { url, error: res.error ?? `HTTP ${res.status}` }
      return { url, ...articleSkeleton(res.body) }
    },
  )

  // State: remember validators always, and URLs on any mode that is meant to move the waterline.
  for (const source of discovered) {
    if (source.endpoint && source.validators) state.endpoints[source.endpoint] = source.validators
  }
  if (mode !== 'probe') {
    const stamp = today()
    for (const post of mode === 'delta' ? fresh : discovered.flatMap((s) => s.posts)) {
      state.seen[post.url] ??= `${post.source}:${stamp}`
    }
  }

  const failed = discovered
    .filter((s) => !s.ok)
    .map((s) => ({ id: s.id, found: s.found, expected_min: s.expected_min }))
  const complete = failed.length === 0 && activity.ok && !sourcesMissing
  state.last_scan = { at: today(), mode, complete, failed: failed.map((f) => f.id) }

  writeIdeas('state.json', state, { compact: true })

  const snapshot = {
    schema_version: 2,
    generated: today(),
    mode,
    complete,
    sources: discovered.map(({ posts, validators, ...rest }) => rest),
    new: fresh,
    extracted: { requested: wantExtract.length, skipped: skippedExtract, items: extracted },
    posts: {
      ok: true,
      locales: corpus.locales,
      unique_slugs: corpus.bySlug.size,
      total_files: corpus.files.length,
      missing_translation: corpus.missingTranslation,
      items: corpus.files.map((f) => ({
        slug: f.slug,
        locale: f.locale,
        title: f.data?.title ?? null,
        date: f.data?.date ?? null,
        h2: f.h2,
        words: f.words,
        images: f.images.length,
        internal_links: f.links.filter((h) => h.startsWith('/')),
      })),
    },
    activity,
  }

  writeIdeas('scan.json', snapshot)

  return { snapshot, state, failed, sourcesMissing, migrated: Boolean(state.migrated_from) }
}

export const stateFile = () => rel(`${IDEAS}/state.json`)
export const staleness = (state) => (state.last_scan?.at ? daysSince(state.last_scan.at) : null)
