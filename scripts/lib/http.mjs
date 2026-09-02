/**
 * HTTP for the reference-blog crawler: conditional GET, one retry, and a real worker pool.
 *
 * Three things the old code did not do:
 *
 * 1. It discarded every response header (`res.headers` was never read) and treated any !res.ok as
 *    an error - so a 304 was indistinguishable from a broken source. Storing ETag/Last-Modified
 *    and sending them back is what turns a repeat scan from seconds into fractions of one.
 * 2. It used a 25 s timeout with no retry. A devlog feed that needs more than 8 s is broken, not
 *    slow; a transient socket error deserves one more try.
 * 3. It "parallelised" extraction with a chunked barrier (`for (i += 4) await Promise.all(batch)`),
 *    so every batch of four paid its slowest URL's latency and three slots sat idle. pool() below
 *    keeps the slots busy and caps how hard any single host gets hit.
 */
export const TIMEOUT_MS = 8_000
const RETRY_DELAY_MS = 400

const UA_PROFILES = {
  default: (userAgent) => ({
    'user-agent': userAgent,
    accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
  }),
  // Some hosts 403 anything that does not look like a browser. Used only where a source needs it.
  browser: () => ({
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/127.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,de;q=0.8',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  }),
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch one URL as text.
 *
 * Returns `{ok, unchanged, status, finalUrl, body, etag, last_modified, error}` and never throws.
 * `unchanged: true` means the server answered 304 and there is no body - the caller must treat
 * that as "nothing new", never as "nothing there".
 */
export async function fetchText(url, options = {}) {
  const {
    ua = 'default',
    userAgent = 'blog-pipeline/1.0',
    validators = null,
    timeout = TIMEOUT_MS,
    retries = 1,
  } = options

  const headers = (UA_PROFILES[ua] ?? UA_PROFILES.default)(userAgent)
  if (validators?.etag) headers['if-none-match'] = validators.etag
  if (validators?.last_modified) headers['if-modified-since'] = validators.last_modified

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      })

      if (res.status === 304) {
        return { ok: true, unchanged: true, status: 304, finalUrl: res.url, body: '', ...validators }
      }
      if (!res.ok) {
        // A 5xx is a hiccup worth one retry; a 4xx is an answer.
        if (res.status >= 500 && attempt < retries) {
          await sleep(RETRY_DELAY_MS)
          continue
        }
        return { ok: false, unchanged: false, status: res.status, finalUrl: res.url, body: '' }
      }

      return {
        ok: true,
        unchanged: false,
        status: res.status,
        finalUrl: res.url,
        body: await res.text(),
        etag: res.headers.get('etag'),
        last_modified: res.headers.get('last-modified'),
      }
    } catch (err) {
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      return { ok: false, unchanged: false, status: 0, finalUrl: url, body: '', error: err.message }
    }
  }
}

/** Counting semaphore. `acquire()` resolves to the matching `release`, which must be called once. */
function semaphore(max) {
  let active = 0
  const waiting = []

  const release = () => {
    active--
    waiting.shift()?.()
  }

  return async () => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve))
    active++
    return release
  }
}

/**
 * Run `worker` over `items`, keeping up to `concurrency` in flight globally and at most `perHost`
 * against any one host. Results come back in input order; a worker that throws yields `{error}`
 * rather than sinking the whole run.
 *
 * The per-host cap is politeness the old chunked loop did not have: it formed batches in input
 * order, so four URLs from the same blog went out simultaneously by accident.
 */
export async function pool(items, worker, options = {}) {
  const {
    concurrency = 6,
    perHost = 2,
    hostOf = (item) => {
      try {
        return new URL(item).host
      } catch {
        return '-'
      }
    },
  } = options

  const results = new Array(items.length)
  const acquire = semaphore(concurrency)

  const queues = new Map()
  items.forEach((item, index) => {
    const host = hostOf(item)
    if (!queues.has(host)) queues.set(host, [])
    queues.get(host).push({ item, index })
  })

  const runners = []
  for (const queue of queues.values()) {
    let cursor = 0
    const take = () => (cursor < queue.length ? queue[cursor++] : null)

    for (let lane = 0; lane < Math.min(perHost, queue.length); lane++) {
      runners.push(
        (async () => {
          for (let job = take(); job; job = take()) {
            const release = await acquire()
            try {
              results[job.index] = await worker(job.item, job.index)
            } catch (err) {
              results[job.index] = { error: err.message }
            } finally {
              release()
            }
          }
        })()
      )
    }
  }

  await Promise.all(runners)
  return results
}
