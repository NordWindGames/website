/**
 * The backlog: post ideas and practice observations, loading and validation.
 *
 * Two things changed from the old blog-backlog.mjs, both of them deletions:
 *
 * 1. `scores.total` is no longer stored, it is computed by total(). The old validator recomputed
 *    every stored total from a *prose* formula string ("total = 0.35*interest + …") parsed by
 *    regex, and failed the run on more than 0.005 of drift - which meant asking a model to do a
 *    four-term weighted sum and then gating on its arithmetic. Now the model writes four integers
 *    and the script multiplies. Derived data that never lands on disk cannot drift.
 * 2. practices.json is folded in as `kind: "practice"`. It had zero script coverage - no writer,
 *    no validator, not in the check - so its schema lived only in skill prose and nothing noticed
 *    what a model wrote there. Its lifecycle is an idea's lifecycle, so it shares the code path.
 *
 * The load-bearing invariant is untouched: nothing here approves anything. Every item starts at
 * status "new" and only a human moves it on.
 */
import { CONFIG, readIdeas, today, writeIdeas } from './ctx.mjs'

export const SCORE_AXES = ['interest', 'evidence', 'ease', 'durability']
export const POST_TYPES = ['progress', 'deep-dive', 'learning', 'milestone', 'refresh']
export const POST_STATUSES = [
  'new',
  'approved',
  'blocked',
  'in_progress',
  'drafted',
  'published',
  'rejected',
]
export const PRACTICE_STATUSES = ['new', 'adopted', 'deferred', 'rejected']
export const NEEDS_SLUG = ['in_progress', 'drafted', 'published']

const POST_FIELDS = [
  'id',
  'created_at',
  'status',
  'type',
  'working_title',
  'angle',
  'locale',
  'scores',
  'internal_links',
  'evidence',
]
const PRACTICE_FIELDS = ['id', 'created_at', 'status', 'observation', 'applies_to']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const statusesFor = (kind) => (kind === 'practice' ? PRACTICE_STATUSES : POST_STATUSES)

/** Weighted total from the four axes, or null when the scores are not usable. */
export function total(item) {
  const s = item.scores
  if (!s || SCORE_AXES.some((a) => !Number.isFinite(s[a]))) return null
  const weights = CONFIG.scoring.weights
  return Number(SCORE_AXES.reduce((sum, a) => sum + (weights[a] ?? 0) * s[a], 0).toFixed(2))
}

/**
 * Load the backlog, normalising the old two-file layout into one `items` array.
 *
 * Reads both schema versions and never writes - a v1 file on disk stays v1 until a command that
 * mutates it saves, so adding this reader could not disturb anything that was already working.
 */
export function load() {
  const raw = readIdeas('backlog.json')
  if (!raw) return null

  const items = []
  for (const idea of raw.items ?? raw.ideas ?? []) {
    const { scores, ...rest } = idea
    items.push({
      kind: idea.kind ?? 'post',
      ...rest,
      // A stored total is dropped on read: total() is the only thing that computes it.
      ...(scores
        ? {
            scores: Object.fromEntries(
              SCORE_AXES.filter((a) => a in scores).map((a) => [a, scores[a]]),
            ),
          }
        : {}),
      ...(scores
        ? { extraAxes: Object.keys(scores).filter((k) => ![...SCORE_AXES, 'total'].includes(k)) }
        : {}),
    })
  }

  // practices.json only exists until the old scripts are deleted; after that it is one array.
  if (!raw.items) {
    for (const practice of readIdeas('practices.json')?.practices ?? []) {
      items.push({ kind: 'practice', ...practice })
    }
  }

  return { schema_version: 2, generated: raw.generated ?? null, no_go: raw.no_go ?? [], items }
}

/** Write the backlog back as v2. `extraAxes` is a read-time annotation and never persisted. */
export function save(backlog) {
  return writeIdeas('backlog.json', {
    schema_version: 2,
    generated: today(),
    no_go: backlog.no_go ?? [],
    items: backlog.items.map(({ extraAxes, ...item }) => item),
  })
}

/** Find one item by full id or by its numeric suffix, so `set approved 003` works. */
export function find(backlog, ref) {
  const needle = String(ref)
  return (
    backlog.items.find((i) => i.id === needle) ??
    backlog.items.find((i) => i.id?.endsWith(`-${needle.padStart(3, '0')}`)) ??
    null
  )
}

/** Next free id for a kind, as <kind>-<year>-<NNN>. */
export function nextId(backlog, kind, year) {
  const prefix = `${kind === 'practice' ? 'practice' : 'idea'}-${year}-`
  const used = backlog.items
    .filter((i) => i.id?.startsWith(prefix))
    .map((i) => Number(i.id.slice(prefix.length)))
    .filter(Number.isFinite)
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(3, '0')}`
}

/**
 * What each status demands before an item may enter it.
 *
 * The old CLI could only produce approved, blocked and rejected - in_progress, drafted and
 * published, the three transitions the writing agent owns, had no command at all and were reached
 * by hand-editing JSON that a validator then complained about. One table covers all of them, and
 * the obligations are enforced at the transition instead of being discovered later by --validate.
 */
export function transition(item, status, opts, corpus) {
  const statuses = statusesFor(item.kind)
  if (!statuses.includes(status)) {
    return `unknown status "${status}" for a ${item.kind} - known: ${statuses.join(', ')}`
  }

  const stamp = today()

  if (item.kind === 'practice') {
    if (status !== 'new' && !opts.reason) return `--reason is required to decide a practice`
    item.status = status
    if (status === 'new') {
      delete item.decision
      delete item.decided_at
    } else {
      item.decision = opts.reason
      item.decided_at = stamp
    }
    return null
  }

  if (status === 'rejected') {
    if (!opts.reason)
      return '--reason is required to reject - the reason is what teaches the next run'
    item.review_note = opts.reason
    item.reviewed_at = stamp
  }

  if (status === 'blocked') {
    if (!opts.reason) return '--reason is required to block, so the blocker is on the record'
    item.blocker = opts.reason
    item.blocked_since ??= stamp
    if (opts.ask) item.followup_question = opts.ask
  } else {
    delete item.blocker
    delete item.blocked_since
  }

  if (status === 'approved') item.reviewed_at = stamp

  if (NEEDS_SLUG.includes(status)) {
    const slug = opts.slug ?? item.assigned_slug
    if (!slug) return `--slug is required to move to "${status}"`
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return `slug must be lowercase kebab-case: "${slug}"`
    item.assigned_slug = slug

    // in_progress means "being written", so the files may not exist yet. drafted and published
    // claim they do, and that claim is checkable.
    if (status !== 'in_progress') {
      const missing = corpus.locales.filter((l) => !corpus.slugsByLocale.get(l)?.has(slug))
      if (missing.length) {
        return `"${slug}" has no file for locale(s) ${missing.join(', ')} - write both before "${status}"`
      }
    }
  }

  item.status = status
  if (opts.note) {
    item.followup_log = [...(item.followup_log ?? []), { at: stamp, note: opts.note }]
  }
  return null
}

/**
 * Cheap, deterministic integrity checks. backlog.json is the one file in this pipeline an LLM
 * writes, which makes it the likeliest place for silent corruption: a status outside the state
 * machine, an axis out of range, an item claiming a slug that was never written.
 */
export function validate(backlog, corpus) {
  const errors = []
  const warnings = []

  const weights = CONFIG.scoring.weights
  const missingWeights = SCORE_AXES.filter((a) => !Number.isFinite(weights[a]))
  const weightSum = SCORE_AXES.reduce((sum, a) => sum + (weights[a] ?? 0), 0)
  if (missingWeights.length) {
    errors.push(`blog.config.json scoring.weights omits: ${missingWeights.join(', ')}`)
  } else if (Math.abs(weightSum - 1) > 0.001) {
    errors.push(`blog.config.json scoring.weights sum to ${weightSum}, not 1`)
  }

  const locales = corpus.locales
  const seenIds = new Set()
  const seenSlugs = new Map()
  const seenTitles = new Map()

  for (const item of backlog.items) {
    const at = item.id ?? '(item without id)'
    const isPost = item.kind !== 'practice'
    const statuses = statusesFor(item.kind)

    for (const field of isPost ? POST_FIELDS : PRACTICE_FIELDS) {
      if (item[field] === undefined || item[field] === null || item[field] === '') {
        errors.push(`${at}: required field "${field}" is missing`)
      }
    }
    if (item.id && !new RegExp(`^${isPost ? 'idea' : 'practice'}-\\d{4}-\\d{3}$`).test(item.id)) {
      errors.push(`${at}: id does not match ${isPost ? 'idea' : 'practice'}-YYYY-NNN`)
    }
    if (item.id && seenIds.has(item.id)) errors.push(`${at}: duplicate id`)
    seenIds.add(item.id)

    if (item.status && !statuses.includes(item.status)) {
      errors.push(`${at}: unknown status "${item.status}" - known: ${statuses.join(', ')}`)
    }
    for (const field of ['created_at', 'reviewed_at', 'blocked_since', 'decided_at']) {
      if (item[field] && !ISO_DATE.test(item[field])) {
        errors.push(`${at}: ${field} "${item[field]}" is not YYYY-MM-DD`)
      }
    }

    if (!isPost) {
      if (item.status !== 'new' && !item.decision) {
        errors.push(`${at}: decided as "${item.status}" but carries no decision`)
      }
      continue
    }

    if (item.type && !POST_TYPES.includes(item.type)) {
      warnings.push(`${at}: unusual type "${item.type}" - known: ${POST_TYPES.join(', ')}`)
    }
    if (item.locale && !['both', ...locales].includes(item.locale)) {
      warnings.push(`${at}: locale "${item.locale}" is neither "both" nor a content locale`)
    }

    if (item.scores && typeof item.scores === 'object') {
      for (const axis of SCORE_AXES) {
        const v = item.scores[axis]
        if (!Number.isInteger(v) || v < 1 || v > 5) {
          errors.push(`${at}: scores.${axis} = ${JSON.stringify(v)}, expected an integer 1-5`)
        }
      }
      for (const extra of item.extraAxes ?? []) {
        warnings.push(`${at}: scores carries an unknown axis "${extra}"`)
      }
    }

    if (item.status === 'rejected' && !item.review_note) {
      errors.push(`${at}: rejected without a review_note - the reason is what teaches the next run`)
    }
    if (item.status === 'blocked') {
      if (!item.blocker) errors.push(`${at}: blocked without a blocker`)
      if (!item.blocked_since) errors.push(`${at}: blocked without blocked_since, so it cannot age`)
      if (!item.followup_question) {
        warnings.push(`${at}: blocked without a followup_question - nobody will know what to ask`)
      }
    }

    if (NEEDS_SLUG.includes(item.status)) {
      if (!item.assigned_slug) {
        errors.push(`${at}: status "${item.status}" but no assigned_slug`)
      } else {
        const missing = locales.filter((l) => !corpus.slugsByLocale.get(l)?.has(item.assigned_slug))
        if (missing.length && item.status === 'in_progress') {
          warnings.push(
            `${at}: in_progress, still missing ` +
              missing.map((l) => `${l}/${item.assigned_slug}.md`).join(', '),
          )
        } else if (missing.length) {
          errors.push(
            `${at}: status "${item.status}" but assigned_slug "${item.assigned_slug}" has no ` +
              `file for locale(s) ${missing.join(', ')}`,
          )
        }
      }
    }
    if (item.assigned_slug) {
      const prev = seenSlugs.get(item.assigned_slug)
      if (prev)
        errors.push(`${at}: assigned_slug "${item.assigned_slug}" is also claimed by ${prev}`)
      seenSlugs.set(item.assigned_slug, at)
    }

    for (const link of item.internal_links ?? []) {
      const slug = String(link)
        .replace(/^\/?(?:[a-z]{2}\/)?blog\//, '')
        .replace(/\/$/, '')
      if (locales.length && !locales.some((l) => corpus.slugsByLocale.get(l)?.has(slug))) {
        warnings.push(`${at}: internal_links names "${slug}", which is not an existing post`)
      }
    }

    const key = String(item.working_title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (key && seenTitles.has(key)) {
      warnings.push(`${at}: working_title is identical to ${seenTitles.get(key)}`)
    }
    seenTitles.set(key, at)
  }

  // Approval is a human act and should carry the date it happened.
  const undated = backlog.items.filter((i) => i.status === 'approved' && !i.reviewed_at)
  if (undated.length) {
    warnings.push(
      `approved but no reviewed_at date: ${undated.map((i) => i.id).join(', ')} - ` +
        'approval is a human act and should carry the date it happened',
    )
  }

  return { errors, warnings }
}
