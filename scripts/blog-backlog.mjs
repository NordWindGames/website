#!/usr/bin/env node
/**
 * Human gate for the devlog idea pipeline. Read the backlog, approve, reject.
 *
 * This is the tool for the periodic five-minute review. Editing backlog.json by hand works
 * too, but this keeps rejection reasons flowing into rejected.md, which sharpens the next
 * research run. See docs/blog-automation.md and _port/blog-pipeline-port-devlog.md.
 *
 * Usage:
 *   node scripts/blog-backlog.mjs                        list everything, highest score first
 *   node scripts/blog-backlog.mjs --status new           list only one status
 *   node scripts/blog-backlog.mjs --show 002             full detail of one idea
 *   node scripts/blog-backlog.mjs --approve 001 002 004  approve one or more
 *   node scripts/blog-backlog.mjs --reject 009 --reason "..."
 *   node scripts/blog-backlog.mjs --block 010 --reason "..." --followup "..." [--note "..."]
 *   node scripts/blog-backlog.mjs --followup-on 010 --note "..."
 *   node scripts/blog-backlog.mjs --unblock 010 [--note "..."]
 *   node scripts/blog-backlog.mjs --next                 what blog-write would pick up next
 *   node scripts/blog-backlog.mjs --validate            integrity check, exit 1 on any error
 *
 * "blocked" means: wanted, but waiting on something outside the pipeline. Every listing
 * reprints it with its age so it cannot rot silently. Do not park such ideas in "new".
 *
 * IDs may be given in full (idea-2026-009) or as the trailing number (009, or 9).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const BACKLOG = join(ROOT, CONFIG.paths.ideas_dir, 'backlog.json')
const REJECTED = join(ROOT, CONFIG.paths.ideas_dir, 'rejected.md')

const STATUSES = ['new', 'approved', 'blocked', 'in_progress', 'drafted', 'published', 'rejected']
const MARK = {
  new: ' ',
  approved: '+',
  blocked: '!',
  in_progress: '>',
  drafted: '~',
  published: '*',
  rejected: 'x',
}

const load = () => JSON.parse(readFileSync(BACKLOG, 'utf8'))
const save = (b) => writeFileSync(BACKLOG, JSON.stringify(b, null, 2) + '\n')

/** Accepts "idea-2026-009", "009" or "9". */
function find(backlog, ref) {
  const norm = String(ref).replace(/^idea-\d{4}-/, '').replace(/^0+/, '')
  const hit = backlog.ideas.filter((i) => i.id.replace(/^idea-\d{4}-/, '').replace(/^0+/, '') === norm)
  if (hit.length !== 1) throw new Error(`no unique idea for "${ref}"`)
  return hit[0]
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)

/**
 * Blocked ideas are the ones that quietly rot: wanted, waiting on something outside the
 * pipeline. Printed loudly and with an age so they cannot be forgotten.
 */
function blockedReport(backlog) {
  const blocked = backlog.ideas.filter((i) => i.status === 'blocked')
  if (!blocked.length) return
  console.log('\n  ' + '='.repeat(92))
  console.log('  BLOCKED - waiting on something outside the pipeline, needs a human decision\n')
  for (const i of blocked) {
    const age = i.blocked_since ? `${daysSince(i.blocked_since)}d since ${i.blocked_since}` : 'no date'
    console.log(`  ! ${i.id.replace(/^idea-\d{4}-/, '')}  ${i.working_title}`)
    console.log(`      blocker:  ${i.blocker ?? '(none recorded)'}   [${age}]`)
    if (i.followup_question) console.log(`      ask:      ${i.followup_question}`)
    if (i.followup_log?.length) {
      for (const entry of i.followup_log.slice(-3)) console.log(`      log:      ${entry}`)
    }
    console.log('')
  }
  console.log('  ' + '='.repeat(92))
}

function list(backlog, statusFilter) {
  const ideas = [...backlog.ideas]
    .filter((i) => !statusFilter || i.status === statusFilter)
    .sort((a, b) => b.scores.total - a.scores.total)
  if (!ideas.length) return console.log(`no ideas with status "${statusFilter}"`)

  console.log(`\n${backlog.ideas.length} ideas, generated ${backlog.generated} (${backlog.mode})\n`)
  console.log('    id   score  type          title')
  console.log('    ' + '-'.repeat(92))
  for (const i of ideas) {
    const short = i.id.replace(/^idea-\d{4}-/, '')
    console.log(
      `  ${MARK[i.status] ?? '?'} ${short}  ${i.scores.total.toFixed(1).padStart(4)}   ` +
        `${i.type.padEnd(11)} ${i.working_title.slice(0, 60)}`
    )
  }
  const counts = {}
  for (const i of backlog.ideas) counts[i.status] = (counts[i.status] ?? 0) + 1
  console.log(
    '\n  legend: + approved, ! blocked, x rejected, > in progress, ~ drafted, * published,' +
      ' blank = awaiting review'
  )
  console.log('  ' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('   '))
  console.log('\n  detail:  node scripts/blog-backlog.mjs --show <id>')
  console.log('  approve: node scripts/blog-backlog.mjs --approve <id> [<id> ...]')
  console.log('  reject:  node scripts/blog-backlog.mjs --reject <id> --reason "..."')
  console.log('  block:   node scripts/blog-backlog.mjs --block <id> --reason "..." --followup "..."')
  console.log('  check:   node scripts/blog-backlog.mjs --validate')
  blockedReport(backlog)
}

function show(idea) {
  const line = (k, v) => v && console.log(`  ${(k + ':').padEnd(16)} ${Array.isArray(v) ? v.join('\n' + ' '.repeat(19)) : v}`)
  console.log(`\n${idea.id}  [${idea.status}]  score ${idea.scores.total}`)
  console.log(idea.working_title + '\n')
  line('type', idea.type)
  line('locale', idea.locale)
  line('angle', idea.angle)
  console.log('')
  line('outline', idea.outline_hint)
  line('evidence', idea.evidence)
  line('internal links', idea.internal_links)
  line('sources', idea.source_urls)
  line('notes', idea.notes)
  line('review note', idea.review_note)
  const s = idea.scores
  console.log(
    `\n  scores:          interest ${s.interest}  evidence ${s.evidence}  ease ${s.ease}  durability ${s.durability}  =  ${s.total}`
  )
  console.log('  (higher is better on all four - see the scoring block in backlog.json)\n')
}

function appendRejection(idea, reason) {
  const md = readFileSync(REJECTED, 'utf8')
  const entry =
    `## ${idea.id} — ${idea.working_title}\n` +
    `Rejected: ${today()}\n` +
    `Score was: ${idea.scores.total} (interest ${idea.scores.interest}, evidence ${idea.scores.evidence}, ` +
    `ease ${idea.scores.ease}, durability ${idea.scores.durability})\n` +
    `Reason: ${reason}\n\n`
  const marker = '---\n'
  const at = md.lastIndexOf(marker)
  const next =
    at === -1
      ? md.trimEnd() + '\n\n---\n\n' + entry
      : md.slice(0, at + marker.length) + '\n' + entry + md.slice(at + marker.length).replace(/^\s*\*No individual rejections yet[^\n]*\n?/m, '')
  writeFileSync(REJECTED, next)
}

/**
 * Weights, parsed out of the scoring.formula string in backlog.json rather than repeated
 * here. That block is the single source of truth for the scoring - a copy in this script
 * would be a second one, and two of them drift.
 */
function weightsFromFormula(formula) {
  const weights = {}
  for (const m of String(formula ?? '').matchAll(/([0-9.]+)\s*\*\s*([a-z_]+)/gi)) {
    weights[m[2]] = Number(m[1])
  }
  return Object.keys(weights).length ? weights : null
}

// Devlog scoring axes (higher always better, none inverted) - replaces the origin's
// demand/fit/ease/distinctness. See _port/blog-pipeline-port-devlog.md section 2.5.
const SCORE_AXES = ['interest', 'evidence', 'ease', 'durability']
const REQUIRED_FIELDS = [
  'id', 'created_at', 'status', 'type', 'working_title', 'angle', 'locale',
  'scores', 'internal_links', 'evidence',
]
// Devlog idea types - replaces coverage-gap/angle-gap/ranking-gap/refresh.
// See _port/blog-pipeline-port-devlog.md section 2.4.
const TYPES = ['progress', 'deep-dive', 'learning', 'milestone', 'refresh']
const NEEDS_SLUG = ['in_progress', 'drafted', 'published']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Slugs that exist on disk, per locale - for the assigned_slug cross-check. */
function slugsOnDisk() {
  const postsDir = join(ROOT, CONFIG.paths.posts_dir)
  if (!existsSync(postsDir)) return {}
  return Object.fromEntries(
    readdirSync(postsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => [
        d.name,
        new Set(
          readdirSync(join(postsDir, d.name))
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace(/\.md$/, ''))
        ),
      ])
  )
}

/**
 * backlog.json is the one file in this pipeline that an LLM writes, which makes it the most
 * likely place for silent corruption: a stated total that does not match its components, a
 * status outside the state machine, an idea claiming a slug that was never written. Every
 * check here is cheap and deterministic; none of them needs judgement.
 */
function validate(backlog) {
  const errors = []
  const warnings = []

  for (const key of ['schema_version', 'generated', 'scoring', 'ideas']) {
    if (!(key in backlog)) errors.push(`backlog.json is missing the top-level "${key}"`)
  }
  if (!Array.isArray(backlog.ideas)) {
    console.error('ERROR backlog.json has no "ideas" array - nothing else can be checked')
    return 1
  }

  const weights = weightsFromFormula(backlog.scoring?.formula)
  if (!weights) {
    errors.push('scoring.formula is missing or unparsable - the totals cannot be verified')
  } else {
    const missing = SCORE_AXES.filter((a) => !(a in weights))
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    if (missing.length) errors.push(`scoring.formula omits: ${missing.join(', ')}`)
    if (Math.abs(sum - 1) > 0.001) errors.push(`scoring.formula weights sum to ${sum}, not 1`)
  }

  const localeSlugs = slugsOnDisk()
  const allLocales = Object.keys(localeSlugs)
  const seenIds = new Set()
  const seenSlugs = new Map()
  const seenTitles = new Map()

  for (const idea of backlog.ideas) {
    const at = idea.id ?? '(idea without id)'

    for (const field of REQUIRED_FIELDS) {
      if (idea[field] === undefined || idea[field] === null || idea[field] === '') {
        errors.push(`${at}: required field "${field}" is missing`)
      }
    }
    if (idea.id && !/^idea-\d{4}-\d{3}$/.test(idea.id)) {
      errors.push(`${at}: id does not match idea-YYYY-NNN`)
    }
    if (idea.id && seenIds.has(idea.id)) errors.push(`${at}: duplicate id`)
    seenIds.add(idea.id)

    if (idea.status && !STATUSES.includes(idea.status)) {
      errors.push(`${at}: unknown status "${idea.status}" - known: ${STATUSES.join(', ')}`)
    }
    if (idea.type && !TYPES.includes(idea.type)) {
      warnings.push(`${at}: unusual type "${idea.type}" - known: ${TYPES.join(', ')}`)
    }
    for (const field of ['created_at', 'reviewed_at', 'blocked_since']) {
      if (idea[field] && !ISO_DATE.test(idea[field])) {
        errors.push(`${at}: ${field} "${idea[field]}" is not YYYY-MM-DD`)
      }
    }
    if (idea.locale && !['both', ...allLocales].includes(idea.locale)) {
      warnings.push(`${at}: locale "${idea.locale}" is neither "both" nor a content locale`)
    }

    // ── scores ────────────────────────────────────────────────────────────────────────
    const s = idea.scores
    if (s && typeof s === 'object') {
      for (const axis of SCORE_AXES) {
        if (!Number.isInteger(s[axis]) || s[axis] < 1 || s[axis] > 5) {
          errors.push(`${at}: scores.${axis} = ${JSON.stringify(s[axis])}, expected an integer 1-5`)
        }
      }
      if (weights && SCORE_AXES.every((a) => Number.isFinite(s[a]))) {
        const computed = Number(
          SCORE_AXES.reduce((sum, a) => sum + (weights[a] ?? 0) * s[a], 0).toFixed(2)
        )
        if (!Number.isFinite(s.total)) {
          errors.push(`${at}: scores.total is missing (the formula gives ${computed})`)
        } else if (Math.abs(s.total - computed) > 0.005) {
          errors.push(`${at}: scores.total is ${s.total} but the formula gives ${computed}`)
        }
      }
      for (const extra of Object.keys(s).filter((k) => ![...SCORE_AXES, 'total'].includes(k))) {
        warnings.push(`${at}: scores carries an unknown axis "${extra}"`)
      }
    }

    // ── obligations that come with a status ───────────────────────────────────────────
    if (idea.status === 'rejected' && !idea.review_note) {
      errors.push(`${at}: rejected without a review_note - the reason is what teaches the next run`)
    }
    if (idea.status === 'blocked') {
      if (!idea.blocker) errors.push(`${at}: blocked without a blocker`)
      if (!idea.blocked_since) errors.push(`${at}: blocked without blocked_since, so it cannot age`)
      if (!idea.followup_question) {
        warnings.push(`${at}: blocked without a followup_question - nobody will know what to ask`)
      }
    }
    if (NEEDS_SLUG.includes(idea.status)) {
      if (!idea.assigned_slug) {
        errors.push(`${at}: status "${idea.status}" but no assigned_slug`)
      } else {
        const missing = allLocales.filter((l) => !localeSlugs[l].has(idea.assigned_slug))
        if (missing.length && idea.status === 'in_progress') {
          warnings.push(
            `${at}: in_progress, still missing ` +
              missing.map((l) => `${l}/${idea.assigned_slug}.md`).join(', ')
          )
        } else if (missing.length) {
          errors.push(
            `${at}: status "${idea.status}" but assigned_slug "${idea.assigned_slug}" has no ` +
              `file for locale(s) ${missing.join(', ')}`
          )
        }
      }
    }
    if (idea.assigned_slug) {
      const prev = seenSlugs.get(idea.assigned_slug)
      if (prev) errors.push(`${at}: assigned_slug "${idea.assigned_slug}" is also claimed by ${prev}`)
      seenSlugs.set(idea.assigned_slug, at)
    }

    // ── links and duplicates ─────────────────────────────────────────────────────────
    for (const link of idea.internal_links ?? []) {
      const slug = String(link).replace(/^\/?(?:[a-z]{2}\/)?blog\//, '').replace(/\/$/, '')
      if (allLocales.length && !allLocales.some((l) => localeSlugs[l].has(slug))) {
        warnings.push(`${at}: internal_links names "${slug}", which is not an existing post`)
      }
    }
    const key = String(idea.working_title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (key && seenTitles.has(key)) {
      warnings.push(`${at}: working_title is identical to ${seenTitles.get(key)}`)
    }
    seenTitles.set(key, at)
  }

  // The pipeline's load-bearing invariant: nothing approves itself, and approval is dated.
  const undated = backlog.ideas.filter((i) => i.status === 'approved' && !i.reviewed_at)
  if (undated.length) {
    warnings.push(
      `approved but no reviewed_at date: ${undated.map((i) => i.id).join(', ')} - ` +
        'approval is a human act and should carry the date it happened'
    )
  }

  for (const w of warnings) console.warn(`warn  ${w}`)
  for (const e of errors) console.error(`ERROR ${e}`)
  console.log(
    `\nblog-backlog --validate: ${backlog.ideas.length} idea(s), ` +
      `${errors.length} error(s), ${warnings.length} warning(s)`
  )
  return errors.length > 0 ? 1 : 0
}

function main() {
  const args = process.argv.slice(2)
  const backlog = load()
  const flagValues = (name) => {
    const i = args.indexOf(name)
    if (i === -1) return null
    const out = []
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j])
    return out
  }

  if (args.includes('--validate')) process.exit(validate(backlog))

  if (args.includes('--show')) return show(find(backlog, flagValues('--show')[0]))

  if (args.includes('--next')) {
    const pick = backlog.ideas
      .filter((i) => i.status === 'approved')
      .sort((a, b) => b.scores.total - a.scores.total)[0]
    if (!pick) return console.log('nothing approved - blog-write has nothing to pick up')
    return show(pick)
  }

  const approve = flagValues('--approve')
  if (approve) {
    for (const ref of approve) {
      const idea = find(backlog, ref)
      idea.status = 'approved'
      idea.reviewed_at = today()
      console.log(`approved  ${idea.id}  ${idea.working_title}`)
    }
    save(backlog)
    return
  }

  const block = flagValues('--block')
  if (block) {
    const reason = (flagValues('--reason') ?? []).join(' ')
    const followup = (flagValues('--followup') ?? []).join(' ')
    const note = (flagValues('--note') ?? []).join(' ')
    if (!reason) {
      console.error('--block needs --reason "..." - name what it is waiting on')
      process.exit(1)
    }
    for (const ref of block) {
      const idea = find(backlog, ref)
      idea.status = 'blocked'
      idea.reviewed_at = today()
      idea.blocker = reason
      idea.blocked_since ??= today()
      if (followup) idea.followup_question = followup
      if (note) (idea.followup_log ??= []).push(`${today()}: ${note}`)
      console.log(`blocked   ${idea.id}  ${idea.working_title}\n          blocker: ${reason}`)
    }
    save(backlog)
    return
  }

  const unblock = flagValues('--unblock')
  if (unblock) {
    const note = (flagValues('--note') ?? []).join(' ')
    for (const ref of unblock) {
      const idea = find(backlog, ref)
      idea.status = 'approved'
      idea.reviewed_at = today()
      if (note) (idea.followup_log ??= []).push(`${today()}: unblocked - ${note}`)
      delete idea.blocker
      delete idea.blocked_since
      delete idea.followup_question
      console.log(`unblocked ${idea.id}  ${idea.working_title}  -> approved`)
    }
    save(backlog)
    return
  }

  // Record a follow-up on a blocked idea without changing its status.
  const followupOn = flagValues('--followup-on')
  if (followupOn) {
    const note = (flagValues('--note') ?? []).join(' ')
    if (!note) {
      console.error('--followup-on needs --note "what happened"')
      process.exit(1)
    }
    for (const ref of followupOn) {
      const idea = find(backlog, ref)
      ;(idea.followup_log ??= []).push(`${today()}: ${note}`)
      console.log(`logged    ${idea.id}  ${note}`)
    }
    save(backlog)
    return
  }

  const reject = flagValues('--reject')
  if (reject) {
    const reason = (flagValues('--reason') ?? []).join(' ')
    if (!reason) {
      console.error('--reject needs --reason "..." - the reason is what teaches the next run')
      process.exit(1)
    }
    for (const ref of reject) {
      const idea = find(backlog, ref)
      idea.status = 'rejected'
      idea.reviewed_at = today()
      idea.review_note = reason
      appendRejection(idea, reason)
      console.log(`rejected  ${idea.id}  ${idea.working_title}\n          reason: ${reason}`)
    }
    save(backlog)
    return
  }

  const status = (flagValues('--status') ?? [])[0]
  if (status && !STATUSES.includes(status)) {
    console.error(`unknown status "${status}". known: ${STATUSES.join(', ')}`)
    process.exit(1)
  }
  list(backlog, status)
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
