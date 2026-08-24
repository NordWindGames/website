#!/usr/bin/env node
/**
 * The periodic entry point for the devlog idea pipeline, for setups without an API key
 * for CI. Replaces a GitHub Actions scheduler with a local nudge plus one command.
 *
 *   node scripts/blog-weekly.mjs --check    due-check for the SessionStart hook; silent unless due
 *   node scripts/blog-weekly.mjs           run the deterministic half and print the briefing
 *
 * Despite the filename (kept for continuity with _port/), the reminder cadence is
 * blog.config.json's cadence_days (30 by default for this devlog port - see
 * _port/blog-pipeline-port-devlog.md section 2.7). Discovery itself is cheap enough to run
 * more often than that; only the *reminder* is paced to cadence_days.
 *
 * --check must never be loud and never fail: it runs on every session start in this
 * repository. Any error is swallowed and treated as "not due". See docs/blog-automation.md.
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const IDEAS = join(ROOT, CONFIG.paths.ideas_dir)
const DUE_AFTER_DAYS = CONFIG.cadence_days ?? 30

const readJson = (name) => {
  const p = join(IDEAS, name)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)

/**
 * Last time discovery ran *completely*, from whichever artefact carries a date.
 *
 * A run that missed a source (`complete: false`, written by blog-sources.mjs) does not count.
 * Otherwise a source that quietly breaks would still reset this clock every period, and the
 * pipeline would report "nothing new" indefinitely while looking perfectly healthy.
 */
function lastRun() {
  const delta = readJson('new-urls.json')
  if (delta?.generated && delta.complete !== false) return delta.generated
  const baseline = readJson('discovered.json')
  if (baseline?.generated && baseline.complete !== false) return baseline.generated
  return readJson('backlog.json')?.generated ?? null
}

function state() {
  const backlog = readJson('backlog.json')
  const counts = {}
  for (const i of backlog?.ideas ?? []) counts[i.status] = (counts[i.status] ?? 0) + 1
  const blocked = (backlog?.ideas ?? []).filter((i) => i.status === 'blocked')
  const delta = readJson('new-urls.json')
  const last = lastRun()
  return {
    counts,
    blocked,
    last,
    days: last ? daysSince(last) : null,
    failedSources: delta?.sources_failed ?? [],
  }
}

function check() {
  const { counts, blocked, last, days, failedSources } = state()
  if (days === null || days < DUE_AFTER_DAYS) return

  const approved = counts.approved ?? 0
  const lines = [`Devlog research is due — last run ${days} days ago (${last}).`]

  // A short source is why this can be due again immediately - say so, or the nudge looks broken.
  if (failedSources.length) {
    lines.push(
      `The last discovery was incomplete: ${failedSources
        .map((f) => `${f.id} ${f.found}/${f.expected_min}`)
        .join(', ')}. Inspect with: node scripts/blog-sources.mjs --probe`
    )
  }

  // More approved ideas than can be written is a reason NOT to generate more.
  if (approved >= 5) {
    lines.push(`${approved} ideas are already approved and unwritten. Consider running /blog-write instead.`)
  } else {
    lines.push(`Run: npm run blog:weekly   then /blog-research`)
  }
  for (const b of blocked) {
    lines.push(`Blocked ${b.id.replace(/^idea-\d{4}-/, '')}: ${b.followup_question ?? b.blocker ?? ''}`)
  }

  const message = lines.join('\n')
  process.stdout.write(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
    })
  )
}

function run() {
  const node = process.execPath
  /**
   * Runs a step and returns its exit code instead of throwing on a non-zero one.
   *
   * blog-sources.mjs exits 2 when a source came in short. That is a partial success - the
   * artefacts are written and the briefing below is still worth printing - so it must not
   * abort this run.
   */
  const sh = (script, ...args) => {
    const res = spawnSync(node, [join(ROOT, 'scripts', script), ...args], {
      stdio: 'inherit',
      cwd: ROOT,
    })
    return res.status ?? 1
  }

  console.log('\n=== 1/3  discovery (deterministic, no tokens) ===')
  const discoveryCode = sh('blog-sources.mjs', '--delta')
  if (discoveryCode !== 0 && discoveryCode !== 2) {
    console.error('\ndiscovery crashed (exit ' + discoveryCode + ') - fix that before anything else.')
    process.exit(1)
  }
  console.log('\n=== 2/3  own inventory ===')
  sh('blog-index.mjs')
  console.log('\n=== 3/3  own development since the last published post ===')
  sh('blog-devlog.mjs')

  const fresh = readJson('new-urls.json')
  const { counts, blocked, failedSources } = state()
  const approved = counts.approved ?? 0

  console.log('\n' + '='.repeat(72))
  console.log(`new reference-blog posts: ${fresh?.count ?? 0}`)
  console.log(
    'backlog: ' + (Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'empty')
  )

  // Printed before everything else that follows, because it invalidates the count above.
  if (failedSources.length) {
    console.log('\nSOURCE FAILURE — this run did NOT see the whole field:')
    for (const f of failedSources) {
      console.log(`  ${f.id.padEnd(15)} ${f.found} posts, expected at least ${f.expected_min}`)
    }
    console.log('  A short source changed its structure. Inspect: node scripts/blog-sources.mjs --probe')
    console.log('  Fix sources.local.json rather than lowering expected_min. "0 new posts" is not')
    console.log('  trustworthy until this is resolved, and the reminder stays due.')
  }

  if (blocked.length) {
    console.log('\nblocked, needs a decision from you:')
    for (const b of blocked) {
      console.log(`  ${b.id.replace(/^idea-\d{4}-/, '')}  ${b.followup_question ?? b.blocker}`)
    }
  }

  console.log('\nnext:')
  if (failedSources.length) {
    console.log('  repair the short source first — see SOURCE FAILURE above')
  }
  if ((fresh?.count ?? 0) === 0) {
    console.log(
      failedSources.length
        ? '  0 new posts, but a source is short — do not read this as a quiet period.'
        : '  nothing new from the references this time — several publish rarely, this is normal.'
    )
  } else {
    console.log('  /blog-research    turn dev-activity.json and the new reference posts into scored ideas')
  }
  if (approved > 0) console.log(`  /blog-write       ${approved} approved idea(s) waiting`)
  console.log('  node scripts/blog-backlog.mjs     review the backlog')
  console.log('  npm run blog:check                gate the posts and the backlog')
  console.log('='.repeat(72) + '\n')

  // A half-failed run must not look like a clean one to whatever called this.
  if (failedSources.length) process.exit(1)
}

try {
  if (process.argv.includes('--check')) check()
  else run()
} catch (err) {
  // --check must never break a session start.
  if (!process.argv.includes('--check')) {
    console.error(err.message)
    process.exit(1)
  }
}
