#!/usr/bin/env node
/**
 * The primary topic supply for the devlog idea pipeline: our own development, not the
 * reference blogs. See _port/blog-pipeline-port-devlog.md section 2.1 and section 1 - a
 * research run that only reads the reference blogs produces a devlog about other people's
 * devlogs, which is the specific failure this script exists to prevent.
 *
 * Deterministic, no network, no tokens: everything comes from local git history (commit log,
 * merge commits, tags), the same style as the other scripts in this pipeline.
 *
 * Reads from this repo AND, if configured, from other local repos - typically the actual game
 * repo, which is where most of what a devlog should cover actually happens. Configure extra
 * repos in content/ideas/repos.local.json (gitignored - an absolute local path is machine-
 * specific, same reasoning as sources.local.json). Without that file, only this repo is scanned.
 *
 *   node scripts/blog-devlog.mjs                    activity since the last published post
 *   node scripts/blog-devlog.mjs --since 2026-06-01  activity since an explicit date
 *
 * Cold start: if no post exists yet to anchor "since" on, the whole git history is used.
 *
 * "Comments" (devlog doc's own commentary on what was built, not just what) come from the full
 * commit message body, not only the subject line - so write real commit bodies in the game repo
 * if you want the research skill to have something to draw on beyond a bare changelog line.
 *
 * Clusters by commit-message prefix (Conventional Commits type) and the directories touched,
 * not by individual commit - the research skill needs themes, not a changelog.
 *
 * Writes content/ideas/dev-activity.json.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const POSTS = join(ROOT, CONFIG.paths.posts_dir)
const OUT = join(ROOT, CONFIG.paths.ideas_dir, 'dev-activity.json')
const REPOS_FILE = join(ROOT, CONFIG.paths.ideas_dir, 'repos.local.json')

const RECORD_SEP = '\x1e' // ASCII record separator
const FIELD_SEP = '\x1f' // ASCII unit separator - splits header fields, incl. multi-line bodies

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 })
}

/** Minimal frontmatter reader - mirrors blog-index.mjs. */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return {}
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
  return data
}

/** The date of the newest post already on disk, across all locales. Null if there is none. */
function newestPublishedDate() {
  if (!existsSync(POSTS)) return null
  const locales = readdirSync(POSTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  let newest = null
  for (const locale of locales) {
    for (const file of readdirSync(join(POSTS, locale)).filter((f) => f.endsWith('.md'))) {
      const data = splitFrontmatter(readFileSync(join(POSTS, locale, file), 'utf8'))
      if (data.date && (!newest || data.date > newest)) newest = data.date
    }
  }
  return newest
}

function flag(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

const since = flag('--since') ?? newestPublishedDate()

/** Repos to scan: this repo, always, plus whatever content/ideas/repos.local.json declares. */
function reposToScan() {
  const repos = [{ id: 'website', label: 'Website', path: ROOT }]
  if (!existsSync(REPOS_FILE)) return { repos, configured: false }
  const declared = JSON.parse(readFileSync(REPOS_FILE, 'utf8')).repos ?? []
  for (const r of declared) {
    if (!existsSync(r.path)) {
      console.warn(`warn  repos.local.json: "${r.id}" path does not exist on this machine - ${r.path}`)
      continue
    }
    repos.push(r)
  }
  return { repos, configured: true }
}

/** Conventional Commits type, or "other" when the subject does not carry one. */
function commitType(subject) {
  const m = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*/i)
  return m ? m[1].toLowerCase() : 'other'
}

function topLevelDir(path) {
  const seg = path.split('/')
  return seg.length > 1 ? seg[0] : '(root)'
}

function commits(repoPath) {
  const format = ['%H', '%ad', '%s', '%b'].join(FIELD_SEP)
  const args = ['log', '--no-merges', `--pretty=format:${RECORD_SEP}${format}${FIELD_SEP}`, '--date=short', '--name-only']
  if (since) args.push(`--since=${since}`)
  let raw
  try {
    raw = git(repoPath, args)
  } catch {
    return [] // not a git repo, or no commits yet
  }
  if (!raw.trim()) return []
  return raw
    .split(RECORD_SEP)
    .map((block) => block.replace(/^\n/, ''))
    .filter((block) => block.trim())
    .map((block) => {
      // The last FIELD_SEP marks the end of the header (hash|date|subject|body); anything
      // after it, up to the trailing blank line, is --name-only's file list for this commit.
      const lastSep = block.lastIndexOf(FIELD_SEP)
      const header = block.slice(0, lastSep)
      const filesPart = block.slice(lastSep + 1)
      const [hash, date, subject, ...bodyParts] = header.split(FIELD_SEP)
      return {
        hash,
        date,
        subject,
        body: bodyParts.join(FIELD_SEP).trim(),
        files: filesPart.split('\n').map((f) => f.trim()).filter(Boolean),
      }
    })
}

function mergedBranches(repoPath) {
  const args = ['log', '--merges', '--pretty=format:%s']
  if (since) args.push(`--since=${since}`)
  let raw
  try {
    raw = git(repoPath, args)
  } catch {
    return []
  }
  const branches = new Set()
  for (const line of raw.split('\n').filter(Boolean)) {
    const pr = line.match(/^Merge pull request #\d+ from \S+\/(.+)$/)
    const br = line.match(/^Merge branch '([^']+)'/)
    if (pr) branches.add(pr[1])
    else if (br) branches.add(br[1])
  }
  return [...branches]
}

function tagsSince(repoPath) {
  let raw
  try {
    raw = git(repoPath, ['for-each-ref', '--format=%(refname:short)|%(creatordate:short)', 'refs/tags'])
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, date] = line.split('|')
      return { name, date }
    })
    .filter((t) => !since || t.date >= since)
}

function closedIssueRefs(commitList) {
  const refs = new Set()
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi
  for (const c of commitList) {
    for (const m of `${c.subject}\n${c.body}`.matchAll(pattern)) refs.add(`#${m[1]}`)
  }
  return [...refs]
}

function analyseRepo(repo) {
  const commitList = commits(repo.path)

  const byType = new Map()
  for (const c of commitList) {
    const type = commitType(c.subject)
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(c)
  }

  const clusters = [...byType.entries()]
    .map(([type, list]) => {
      const dirCounts = new Map()
      const fileCounts = new Map()
      for (const c of list) {
        for (const f of c.files) {
          dirCounts.set(topLevelDir(f), (dirCounts.get(topLevelDir(f)) ?? 0) + 1)
          fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
        }
      }
      return {
        type,
        commit_count: list.length,
        directories: [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
        files_touched_most: [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => f),
        // `comment` is the full commit body (devlog doc: "your comments"), not just the
        // changelog-style subject line - the research skill's raw material for a real post.
        commits: list.map((c) => ({
          hash: c.hash.slice(0, 12),
          date: c.date,
          subject: c.subject,
          comment: c.body || null,
        })),
      }
    })
    .sort((a, b) => b.commit_count - a.commit_count)

  const dates = commitList.map((c) => c.date).sort()

  return {
    id: repo.id,
    label: repo.label,
    commit_count: commitList.length,
    span: commitList.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    clusters,
    merged_branches: mergedBranches(repo.path),
    tags: tagsSince(repo.path),
    closed_issue_refs: closedIssueRefs(commitList),
  }
}

const { repos, configured } = reposToScan()
const perRepo = repos.map(analyseRepo)

const out = {
  generated: new Date().toISOString().slice(0, 10),
  since,
  cold_start: since === null,
  game_repo_configured: configured,
  repos: perRepo,
}

writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(since ? `activity since ${since} (last published post)` : 'cold start: no published post yet, using full git history')
if (!configured) {
  console.log(
    'note: no content/ideas/repos.local.json - only this website repo was scanned. ' +
      'Copy content/ideas/repos.example.json to repos.local.json and point it at the game ' +
      'repo once it exists locally; that is the actual primary source for devlog topics.'
  )
}
for (const r of perRepo) {
  console.log(`\n${r.label} (${r.id}): ${r.commit_count} commit(s) across ${r.clusters.length} cluster(s)`)
  for (const c of r.clusters) {
    console.log(`  ${c.type.padEnd(10)} ${String(c.commit_count).padStart(3)} commit(s)  ${c.directories.slice(0, 4).join(', ')}`)
  }
  if (r.merged_branches.length) console.log(`  merged branches: ${r.merged_branches.join(', ')}`)
  if (r.tags.length) console.log(`  tags: ${r.tags.map((t) => t.name).join(', ')}`)
}
console.log(`\nwrote ${CONFIG.paths.ideas_dir}/dev-activity.json`)
