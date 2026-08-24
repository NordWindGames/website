#!/usr/bin/env node
/**
 * One gate for everything a blog post must satisfy before it is claimed done.
 *
 *   npm run blog:check
 *
 * Runs all four gates and - unlike `a && b && c` - keeps going after a failure so one pass
 * shows every problem instead of the first one. Rebuilds content/ideas/blog-index.json first,
 * because a stale inventory makes the link checks lie.
 *
 * content/ideas/backlog.json is gitignored (privacy: it can carry reference-blog URLs, see
 * _port/blog-pipeline-port-devlog.md and this repo's .gitignore), so it does not exist on a
 * fresh CI checkout. The backlog gate is skipped with a note rather than failing when the
 * file is missing, so `blog:check` still works both locally (all four gates) and in CI
 * (inventory + conventions + images).
 *
 * Ported from a competitor-monitoring pipeline (see docs/blog-automation.md) into a personal
 * devlog per _port/blog-pipeline-port-devlog.md.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = process.argv.includes('--strict')

const BACKLOG = join(ROOT, 'content', 'ideas', 'backlog.json')

const GATES = [
  { name: 'own inventory', script: 'blog-index.mjs', args: [] },
  { name: 'conventions', script: 'blog-lint.mjs', args: STRICT ? ['--strict'] : [] },
  { name: 'images', script: 'blog-assets.mjs', args: [] },
  { name: 'backlog', script: 'blog-backlog.mjs', args: ['--validate'] },
]

const results = []
for (const gate of GATES) {
  if (gate.name === 'backlog' && !existsSync(BACKLOG)) {
    console.log(`\n${'='.repeat(78)}\n=== ${gate.name}  (skipped)\n${'='.repeat(78)}`)
    console.log('SKIP  content/ideas/backlog.json does not exist here (gitignored, local-only) - nothing to validate')
    results.push({ ...gate, code: 0, skipped: true })
    continue
  }
  console.log(`\n${'='.repeat(78)}\n=== ${gate.name}  (${gate.script} ${gate.args.join(' ')})\n${'='.repeat(78)}`)
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts', gate.script), ...gate.args], {
    stdio: 'inherit',
    cwd: ROOT,
  })
  results.push({ ...gate, code: run.status ?? 1 })
}

const failed = results.filter((r) => r.code !== 0)

console.log(`\n${'='.repeat(78)}`)
for (const r of results) console.log(`  ${r.skipped ? 'skip' : r.code === 0 ? 'pass' : 'FAIL'}  ${r.name}`)
if (failed.length) {
  console.log(
    `\nblog:check FAILED - ${failed.length} of ${results.length} gate(s): ` +
      failed.map((r) => r.name).join(', ')
  )
} else {
  console.log('\nblog:check passed. Still owed by hand: a human reading the post.')
}
console.log('='.repeat(78) + '\n')

process.exit(failed.length ? 1 : 0)
