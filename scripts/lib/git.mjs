/**
 * Our own development, read from git: what changed since the last published post.
 *
 * This is the actual topic source for the devlog. The reference blogs teach format and cadence;
 * what to write about comes from here.
 *
 * Two changes from the old blog-devlog.mjs: the three git calls per repo run concurrently instead
 * of blocking the event loop with execFileSync, and tag filtering happens in git rather than
 * pulling every tag in the repo and filtering the list in JS.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import { ROOT, readIdeas } from './ctx.mjs'

const run = promisify(execFile)

// ASCII record/field separators: a commit body is arbitrary text, including newlines and any
// punctuation, so the delimiters have to be characters git will never emit inside one.
const RECORD_SEP = '\x1e'
const FIELD_SEP = '\x1f'

async function git(cwd, args) {
  try {
    const { stdout } = await run('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch {
    return null // not a git repo, no commits yet, or git is missing
  }
}

/**
 * Repos to scan: this one, plus anything in repos.local.json (gitignored - it holds machine
 * specific absolute paths). In practice the game repo, not the website, is where devlog-worthy
 * activity happens; without it configured, `configured` is false and the caller must say so
 * rather than presenting website-only activity as the whole picture.
 */
export function reposToScan() {
  const declared = readIdeas('repos.local.json')?.repos ?? []
  const repos = [{ id: 'website', label: 'Website', path: ROOT }]
  const missing = []

  for (const repo of declared) {
    if (!repo.path) continue
    if (existsSync(repo.path)) repos.push({ id: repo.id, label: repo.label ?? repo.id, path: repo.path })
    else missing.push(repo.path)
  }

  return { repos, configured: declared.length > 0, missing }
}

const commitType = (subject) => subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*/i)?.[1]?.toLowerCase() ?? 'other'
const topDir = (path) => (path.includes('/') ? path.split('/')[0] : '(root)')

function parseCommits(raw) {
  if (!raw?.trim()) return []

  return raw
    .split(RECORD_SEP)
    .filter((block) => block.trim())
    .map((block) => {
      // The last FIELD_SEP ends the header; what follows is --name-only's file list.
      const cut = block.lastIndexOf(FIELD_SEP)
      const [hash, date, subject, ...body] = block.slice(0, cut).replace(/^\n/, '').split(FIELD_SEP)
      return {
        hash,
        date,
        subject,
        body: body.join(FIELD_SEP).trim(),
        files: block.slice(cut + 1).split('\n').map((f) => f.trim()).filter(Boolean),
      }
    })
}

function parseMerges(raw) {
  const branches = new Set()
  for (const line of (raw ?? '').split('\n').filter(Boolean)) {
    const pr = line.match(/^Merge pull request #\d+ from \S+\/(.+)$/)
    const br = line.match(/^Merge branch '([^']+)'/)
    if (pr) branches.add(pr[1])
    else if (br) branches.add(br[1])
  }
  return [...branches]
}

/** One repo's activity since `since` (ISO date, or null for everything). */
export async function readRepo(repo, since) {
  const logArgs = [
    'log',
    '--no-merges',
    `--pretty=format:${RECORD_SEP}${['%H', '%ad', '%s', '%b'].join(FIELD_SEP)}${FIELD_SEP}`,
    '--date=short',
    '--name-only',
  ]
  const mergeArgs = ['log', '--merges', '--pretty=format:%s']
  // Let git sort and cap the tags instead of reading every ref and filtering in JS.
  const tagArgs = [
    'for-each-ref',
    '--format=%(refname:short)|%(creatordate:short)',
    '--sort=-creatordate',
    '--count=25',
    'refs/tags',
  ]
  if (since) {
    logArgs.push(`--since=${since}`)
    mergeArgs.push(`--since=${since}`)
  }

  const [logRaw, mergeRaw, tagRaw] = await Promise.all([
    git(repo.path, logArgs),
    git(repo.path, mergeArgs),
    git(repo.path, tagArgs),
  ])

  const commits = parseCommits(logRaw)

  const byType = new Map()
  for (const c of commits) {
    const type = commitType(c.subject)
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(c)
  }

  const clusters = [...byType.entries()]
    .map(([type, list]) => {
      const dirs = new Map()
      for (const c of list) {
        for (const f of c.files) dirs.set(topDir(f), (dirs.get(topDir(f)) ?? 0) + 1)
      }
      return {
        type,
        commit_count: list.length,
        directories: [...dirs.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
        // `comment` is the full commit body, not the subject line. That is where "what I tried,
        // what did not work, why" lives - the raw material for a learning or deep-dive post. A
        // cluster whose comments are all null is a changelog with nothing to say yet.
        commits: list.map((c) => ({
          hash: c.hash.slice(0, 12),
          date: c.date,
          subject: c.subject,
          comment: c.body || null,
        })),
      }
    })
    .sort((a, b) => b.commit_count - a.commit_count)

  const dates = commits.map((c) => c.date).sort()
  const tags = (tagRaw ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, date] = line.split('|')
      return { name, date }
    })
    .filter((t) => !since || t.date >= since)

  return {
    id: repo.id,
    label: repo.label,
    ok: logRaw !== null,
    commit_count: commits.length,
    span: commits.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    clusters,
    merged_branches: parseMerges(mergeRaw),
    tags,
  }
}

/** All configured repos, scanned concurrently. */
export async function readActivity(since) {
  const { repos, configured, missing } = reposToScan()
  const scanned = await Promise.all(repos.map((repo) => readRepo(repo, since)))

  return {
    ok: scanned.every((r) => r.ok),
    since: since ?? null,
    cold_start: !since,
    game_repo_configured: configured,
    unreachable_paths: missing,
    repos: scanned,
  }
}
