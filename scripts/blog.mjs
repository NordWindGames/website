#!/usr/bin/env node
/**
 * The devlog pipeline CLI. Zero dependencies, Node built-ins only.
 *
 *   node scripts/blog.mjs check [--strict] [--only lint|assets|backlog]
 *
 * Replaces nine standalone blog-*.mjs scripts that shared no code and talked to each other only
 * through JSON files and spawnSync. See docs/blog-automation.md.
 *
 * Command modules are imported lazily, one per subcommand. That is not a startup-time trick: it
 * means a parse error in the crawler cannot take down `check`, which is the one command CI runs.
 */
import { parseArgs } from './lib/ctx.mjs'

const USAGE = `blog - devlog pipeline

  node scripts/blog.mjs status
      What the last scan found, what is approved, what to do next. Never touches the network.

  node scripts/blog.mjs scan [--full|--seed|--probe] [--extract N] [--no-refs]
      Reference blogs, our own git activity and our own post inventory into one snapshot
      (content/ideas/scan.json). Exit 1 if a source came in under its expected_min.
        --full      baseline: refetch everything, ignore stored validators, skip extraction
        --seed      like --full, but records every URL as seen so the next delta is quiet
        --probe     reachability only, writes nothing
        --extract N how many new URLs to read the shape of (default 20, 0 to skip)
        --no-refs   skip the reference blogs, only look at our own repos and posts

  node scripts/blog.mjs extract <url> [<url> ...]
      Article shape (title, date, heading outline, length) as JSON on stdout.

  node scripts/blog.mjs idea [<id>] [--status S] [--kind post|practice] [--next]
      List the backlog, show one item, or (--next) the approved post idea with the top score.

  node scripts/blog.mjs add
      Append items from JSON on stdin (one object or an array). Ids are assigned, status is
      forced to "new". Nothing in this pipeline approves its own output.

  node scripts/blog.mjs set <status> <id> [<id> ...] [--reason "…"] [--ask "…"]
                            [--note "…"] [--slug <slug>]
      Move items through the state machine. Statuses for a post idea:
        new approved blocked in_progress drafted published rejected
      For a practice: new adopted deferred rejected.

  node scripts/blog.mjs note <id> "what happened"
      Append to an item's followup log without changing its status.

  node scripts/blog.mjs check [--strict] [--only lint|assets|backlog]
      Run the quality gates. Exit 1 on any error, or on any warning with --strict.

Also available as: npm run blog:scan, npm run blog:check
`

const banner = (title) => {
  const line = '='.repeat(78)
  console.log(`\n${line}\n=== ${title}\n${line}`)
}

/**
 * What to do next, from what is already on disk.
 *
 * Hard rule: status never makes a network request. It is the command you run to orient yourself,
 * and it has to answer instantly and offline.
 */
async function status(argv) {
  if (argv.length) {
    console.error('status takes no arguments')
    return 2
  }

  const { readIdeas, daysSince } = await import('./lib/ctx.mjs')
  const [{ readCorpus }, backlogLib] = await Promise.all([
    import('./lib/posts.mjs'),
    import('./lib/backlog.mjs'),
  ])

  const corpus = readCorpus()
  const snapshot = readIdeas('scan.json')
  const backlog = backlogLib.load()

  console.log(
    `posts:   ${corpus.bySlug.size} on disk (${corpus.files.length} files across ${corpus.locales.join(', ') || 'no locales'})`,
  )
  for (const m of corpus.missingTranslation) {
    console.log(`  warn   ${m.slug} exists only in ${m.has.join(', ')}`)
  }

  if (!snapshot) {
    console.log('scan:    never run. Start with: npm run blog:scan')
  } else {
    const age = daysSince(snapshot.generated)
    console.log(
      `scan:    ${snapshot.generated} (${age === 0 ? 'today' : `${age}d ago`}), ` +
        `${snapshot.new.length} new reference post(s)` +
        (snapshot.complete ? '' : ', INCOMPLETE'),
    )
    for (const s of snapshot.sources.filter((s) => !s.ok)) {
      console.log(
        `  FAIL   ${s.id} ${s.found}/${s.expected_min} - inspect with: node scripts/blog.mjs scan --probe`,
      )
    }
    const commits = (snapshot.activity?.repos ?? []).reduce((n, r) => n + r.commit_count, 0)
    console.log(
      `         ${commits} commit(s) of our own since ${snapshot.activity?.since ?? 'the beginning'}`,
    )
  }

  if (!backlog) {
    console.log('backlog: none yet')
  } else {
    const counts = {}
    for (const i of backlog.items) counts[i.status] = (counts[i.status] ?? 0) + 1
    console.log(
      `backlog: ${backlog.items.length} item(s)` +
        (Object.keys(counts).length
          ? ` - ${Object.entries(counts)
              .map(([s, n]) => `${s} ${n}`)
              .join(', ')}`
          : ''),
    )
    for (const item of backlog.items.filter((i) => i.status === 'blocked')) {
      const age = item.blocked_since ? `${daysSince(item.blocked_since)}d` : '?'
      console.log(`  blocked ${age}  ${item.id}: ${item.followup_question ?? item.blocker}`)
    }
  }

  const approved = (backlog?.items ?? []).filter(
    (i) => i.kind !== 'practice' && i.status === 'approved',
  )
  console.log('')
  if (approved.length) {
    console.log(`next:    ${approved.length} approved and unwritten. Write one: /blog-write`)
  } else if (!snapshot || snapshot.new.length || !corpus.bySlug.size) {
    console.log('next:    npm run blog:scan, then /blog-research to turn it into scored ideas')
  } else {
    console.log('next:    nothing approved. Review with: node scripts/blog.mjs idea')
  }
  return 0
}

async function scan(argv) {
  const args = parseArgs(argv)
  const unknown = args.unknown(['full', 'seed', 'probe', 'extract', 'no-refs'])
  if (unknown.length) {
    console.error(`unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}`)
    return 2
  }

  const lib = await import('./lib/scan.mjs')
  const { readIdeas } = await import('./lib/ctx.mjs')

  if (args.has('probe')) {
    const sources = readIdeas('sources.local.json')?.sources
    if (!sources) {
      console.error('content/ideas/sources.local.json is missing - copy sources.example.json to it')
      return 1
    }
    banner('probe: endpoint reachability per user-agent profile')
    const started = Date.now()
    for (const r of await lib.probe(sources)) {
      const verdict = r.status === 200 ? 'ok  ' : r.status ? `${r.status} ` : 'err '
      console.log(
        `  ${verdict} ${r.id.padEnd(16)} ${r.ua.padEnd(8)} ${r.label.padEnd(9)} ` +
          `${r.bytes ? `${Math.round(r.bytes / 1024)}kb` : (r.error ?? '')}`,
      )
    }
    console.log(
      `\nprobe finished in ${((Date.now() - started) / 1000).toFixed(1)}s. Nothing written.`,
    )
    return 0
  }

  const mode = args.has('full') ? 'full' : args.has('seed') ? 'seed' : 'delta'
  const extract = args.value('extract') === null ? 20 : Number(args.value('extract'))
  if (!Number.isInteger(extract) || extract < 0) {
    console.error(`--extract expects a non-negative integer, not "${args.value('extract')}"`)
    return 2
  }

  const started = Date.now()
  const { snapshot, failed, migrated, sourcesMissing } = await lib.scan({
    mode,
    extract,
    refs: !args.has('no-refs'),
  })

  if (migrated)
    console.log('migrated the old seen.json into state.json (seen.json left in place)\n')

  banner(`sources (${mode})`)
  if (sourcesMissing) {
    console.log('  none - content/ideas/sources.local.json is missing')
  } else if (!snapshot.sources.length) {
    console.log('  none scanned')
  }
  for (const s of snapshot.sources) {
    console.log(
      `  ${s.ok ? 'pass' : 'FAIL'}  ${s.id.padEnd(16)} ${String(s.found).padStart(3)}/${s.expected_min}` +
        (s.cached ? '  cached (304, not refetched)' : ''),
    )
    for (const a of s.attempts.filter((a) => a.error || a.status >= 400 || a.status === 0)) {
      console.log(`          ${a.status || 'err'}  ${a.url}${a.error ? ` - ${a.error}` : ''}`)
    }
    if (s.hint) {
      console.log(`          pathFilter matched nothing. Available path shapes:`)
      for (const [prefix, n] of s.hint)
        console.log(`            ${String(n).padStart(4)}  ${prefix}`)
    }
  }

  banner('new reference posts')
  console.log(`  ${snapshot.new.length} new since the last scan`)
  for (const p of snapshot.new.slice(0, 15)) {
    console.log(`    ${(p.lastmod ?? '').slice(0, 10).padEnd(10)}  ${p.source.padEnd(16)} ${p.url}`)
  }
  if (snapshot.new.length > 15) console.log(`    … ${snapshot.new.length - 15} more in scan.json`)

  const ex = snapshot.extracted
  const failedExtracts = ex.items.filter((i) => i.error).length
  console.log(
    `\n  extracted the shape of ${ex.items.length - failedExtracts}/${ex.requested}` +
      (failedExtracts ? ` (${failedExtracts} failed)` : '') +
      // Never let a capped run read as a complete one.
      (ex.skipped ? `, ${ex.skipped} NOT extracted (raise --extract to cover them)` : ''),
  )

  banner('our own development')
  const act = snapshot.activity
  console.log(`  since ${act.since ?? 'the beginning (no published post yet)'}`)
  for (const repo of act.repos) {
    console.log(
      `  ${repo.label.padEnd(16)} ${String(repo.commit_count).padStart(4)} commit(s)` +
        (repo.span ? `  ${repo.span.from} … ${repo.span.to}` : '') +
        (repo.tags.length ? `  tags: ${repo.tags.map((t) => t.name).join(', ')}` : ''),
    )
    for (const c of repo.clusters.slice(0, 6)) {
      const withBody = c.commits.filter((x) => x.comment).length
      console.log(
        `      ${c.type.padEnd(10)} ${String(c.commit_count).padStart(3)}  ` +
          `${withBody}/${c.commit_count} with a commit body  ${c.directories.slice(0, 3).join(', ')}`,
      )
    }
  }
  if (!act.game_repo_configured) {
    console.log(
      '\n  repos.local.json is not set up, so this is website-repo activity only.\n' +
        '  Copy content/ideas/repos.example.json and point it at the game repo.',
    )
  }
  for (const p of act.unreachable_paths)
    console.log(`  warn  declared repo path does not exist: ${p}`)

  banner('our own posts')
  console.log(
    `  ${snapshot.posts.unique_slugs} post(s), ${snapshot.posts.total_files} file(s) across ${snapshot.posts.locales.join(', ') || 'no locales'}`,
  )
  for (const m of snapshot.posts.missing_translation) {
    console.log(`  warn  ${m.slug} exists only in ${m.has.join(', ')}`)
  }

  banner('summary')
  console.log(`  wrote content/ideas/scan.json and content/ideas/state.json`)
  console.log(`  finished in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  if (sourcesMissing) {
    console.error(
      '\nINCOMPLETE: content/ideas/sources.local.json does not exist, so no reference blog was\n' +
        'looked at. That is not "nothing new" - it is a scan that could not look. Copy\n' +
        'content/ideas/sources.example.json to sources.local.json and fill in the real sources,\n' +
        'or pass --no-refs if you only wanted our own activity.',
    )
    return 1
  }
  if (failed.length) {
    console.error(
      `\nINCOMPLETE: ${failed.map((f) => `${f.id} ${f.found}/${f.expected_min}`).join(', ')}\n` +
        'A source under its expected_min changed its structure. Inspect it with --probe and fix\n' +
        'the endpoint or pathFilter. Never lower expected_min to clear this - that is how a\n' +
        'silently broken source starts looking like a quiet week.',
    )
    return 1
  }
  return 0
}

async function extract(argv) {
  const urls = argv.filter((a) => a.startsWith('http'))
  if (!urls.length) {
    console.error('extract expects one or more http(s) URLs')
    return 2
  }

  const { CONFIG } = await import('./lib/ctx.mjs')
  const { fetchText, pool } = await import('./lib/http.mjs')
  const { articleSkeleton } = await import('./lib/parse.mjs')

  const items = await pool(urls, async (url) => {
    const res = await fetchText(url, { ua: 'browser', userAgent: CONFIG.brand.user_agent })
    if (!res.ok) return { url, error: res.error ?? `HTTP ${res.status}` }
    return { url, ...articleSkeleton(res.body) }
  })

  process.stdout.write(`${JSON.stringify(items, null, 2)}\n`)
  return items.every((i) => i.error) ? 1 : 0
}

const MARK = {
  new: ' ',
  approved: '+',
  blocked: '!',
  in_progress: '>',
  drafted: '~',
  published: '*',
  rejected: 'x',
  adopted: '+',
  deferred: '?',
}

/** Load the backlog and the corpus, or explain why not. */
async function backlogContext() {
  const [lib, { readCorpus }] = await Promise.all([
    import('./lib/backlog.mjs'),
    import('./lib/posts.mjs'),
  ])
  const backlog = lib.load()
  if (!backlog) {
    console.error('content/ideas/backlog.json does not exist yet - run `blog add` to create it')
    return null
  }
  return { lib, backlog, corpus: readCorpus() }
}

async function idea(argv) {
  const args = parseArgs(argv)
  const unknown = args.unknown(['status', 'kind', 'next'])
  if (unknown.length) {
    console.error(`unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}`)
    return 2
  }

  const ctx = await backlogContext()
  if (!ctx) return 1
  const { lib, backlog } = ctx

  if (args.has('next')) {
    const ready = backlog.items
      .filter((i) => i.kind !== 'practice' && i.status === 'approved')
      .sort((a, b) => (lib.total(b) ?? 0) - (lib.total(a) ?? 0))
    if (!ready.length) {
      console.log(
        'nothing approved. That is the human gate working, not an obstacle to route around.',
      )
      return 0
    }
    console.log(JSON.stringify({ ...ready[0], score_total: lib.total(ready[0]) }, null, 2))
    return 0
  }

  const [ref] = args.positional
  if (ref) {
    const item = lib.find(backlog, ref)
    if (!item) {
      console.error(`no item matches "${ref}"`)
      return 1
    }
    console.log(JSON.stringify({ ...item, score_total: lib.total(item) }, null, 2))
    return 0
  }

  let items = backlog.items
  if (args.value('kind')) items = items.filter((i) => (i.kind ?? 'post') === args.value('kind'))
  if (args.value('status')) items = items.filter((i) => i.status === args.value('status'))

  if (!items.length) {
    console.log('no matching items')
    return 0
  }

  const counts = {}
  for (const i of backlog.items) counts[i.status] = (counts[i.status] ?? 0) + 1

  console.log(`backlog generated ${backlog.generated ?? 'never'}\n`)
  for (const item of [...items].sort((a, b) => (lib.total(b) ?? 0) - (lib.total(a) ?? 0))) {
    const score = lib.total(item)
    console.log(
      ` ${MARK[item.status] ?? '?'} ${(item.id ?? '?').padEnd(17)} ` +
        `${score === null ? '    ' : score.toFixed(2)}  ${(item.type ?? item.applies_to ?? '-').padEnd(10)} ` +
        `${item.working_title ?? item.observation ?? '(untitled)'}`,
    )
    if (item.status === 'blocked') {
      const { daysSince } = await import('./lib/ctx.mjs')
      const age = item.blocked_since ? `${daysSince(item.blocked_since)}d` : '?'
      console.log(
        `     blocked ${age}: ${item.blocker}${item.followup_question ? ` - ask: ${item.followup_question}` : ''}`,
      )
    }
  }
  console.log(
    `\n${items.length} shown of ${backlog.items.length}. ` +
      Object.entries(counts)
        .map(([s, n]) => `${s} ${n}`)
        .join(', '),
  )
  return 0
}

async function add(argv) {
  if (argv.length) {
    console.error('add takes no arguments - pipe JSON on stdin')
    return 2
  }

  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) {
    console.error('nothing on stdin. Pipe one JSON object or an array of them.')
    return 2
  }

  let incoming
  try {
    incoming = JSON.parse(text)
  } catch (err) {
    console.error(`stdin is not valid JSON: ${err.message}`)
    return 2
  }
  incoming = Array.isArray(incoming) ? incoming : [incoming]

  const [lib, { readCorpus }, ctxLib] = await Promise.all([
    import('./lib/backlog.mjs'),
    import('./lib/posts.mjs'),
    import('./lib/ctx.mjs'),
  ])
  const backlog = lib.load() ?? { schema_version: 2, generated: null, no_go: [], items: [] }
  const corpus = readCorpus()
  const year = ctxLib.today().slice(0, 4)

  const added = []
  for (const raw of incoming) {
    const kind = raw.kind === 'practice' ? 'practice' : 'post'
    const item = {
      ...raw,
      kind,
      id: lib.nextId(backlog, kind, year),
      created_at: raw.created_at ?? ctxLib.today(),
      // The load-bearing invariant: nothing here approves its own output.
      status: 'new',
    }
    delete item.reviewed_at
    if (item.scores) delete item.scores.total
    backlog.items.push(item)
    added.push(item)
  }

  const { errors, warnings } = lib.validate(backlog, corpus)
  for (const w of warnings) console.warn(`warn  ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`)
    console.error(`\n${errors.length} error(s) - nothing written.`)
    return 1
  }

  lib.save(backlog)
  for (const item of added) {
    console.log(`added ${item.id}  ${item.working_title ?? item.observation ?? ''}`)
  }
  console.log(
    `\n${added.length} item(s) added at status "new". Review with: node scripts/blog.mjs idea`,
  )
  return 0
}

async function set(argv) {
  const args = parseArgs(argv)
  const unknown = args.unknown(['reason', 'ask', 'note', 'slug'])
  if (unknown.length) {
    console.error(`unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}`)
    return 2
  }

  const [status, ...refs] = args.positional
  if (!status || !refs.length) {
    console.error('usage: blog set <status> <id> [<id> ...]  - at least one id is required')
    return 2
  }

  const ctx = await backlogContext()
  if (!ctx) return 1
  const { lib, backlog, corpus } = ctx

  const opts = {
    reason: args.value('reason'),
    ask: args.value('ask'),
    note: args.value('note'),
    slug: args.value('slug'),
  }

  const changed = []
  for (const ref of refs) {
    const item = lib.find(backlog, ref)
    if (!item) {
      console.error(`no item matches "${ref}" - nothing written`)
      return 1
    }
    const problem = lib.transition(item, status, opts, corpus)
    if (problem) {
      console.error(`${item.id}: ${problem} - nothing written`)
      return 1
    }
    changed.push(item)
  }

  const { errors } = lib.validate(backlog, corpus)
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`)
    console.error('\nthe result would not validate - nothing written.')
    return 1
  }

  lib.save(backlog)
  for (const item of changed) console.log(`${item.id} -> ${item.status}`)
  return 0
}

async function note(argv) {
  const [ref, ...rest] = argv
  const text = rest.join(' ').trim()
  if (!ref || !text) {
    console.error('usage: blog note <id> "what happened"')
    return 2
  }

  const ctx = await backlogContext()
  if (!ctx) return 1
  const { lib, backlog } = ctx
  const { today } = await import('./lib/ctx.mjs')

  const item = lib.find(backlog, ref)
  if (!item) {
    console.error(`no item matches "${ref}"`)
    return 1
  }
  item.followup_log = [...(item.followup_log ?? []), { at: today(), note: text }]
  lib.save(backlog)
  console.log(`${item.id}: noted (${item.followup_log.length} entr(y/ies), status unchanged)`)
  return 0
}

async function check(argv) {
  const args = parseArgs(argv)
  const unknown = args.unknown(['strict', 'only'])
  if (unknown.length) {
    console.error(`unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}`)
    return 2
  }

  const strict = args.has('strict')
  const only = args.value('only')
  if (only && !['lint', 'assets', 'backlog'].includes(only)) {
    console.error(`--only must be lint, assets or backlog, not "${only}"`)
    return 2
  }
  const wanted = (name) => !only || only === name

  const [{ readCorpus }, gates, backlogLib] = await Promise.all([
    import('./lib/posts.mjs'),
    import('./lib/gates.mjs'),
    import('./lib/backlog.mjs'),
  ])

  // One disk pass, shared by every gate. There is no inventory file to go stale.
  const corpus = readCorpus()
  const results = []

  if (wanted('lint')) {
    banner('conventions')
    const { errors, warnings, inbound, floor } = gates.lint(corpus)
    report(errors, warnings)

    const slugs = [...corpus.bySlug.keys()].sort()
    if (slugs.length) {
      console.log('\ninbound blog links per slug:')
      for (const slug of slugs) {
        const n = inbound.get(slug)?.size ?? 0
        console.log(
          `  ${String(n).padStart(2)}  ${slug}${n === 0 ? '   <- orphan, nothing links here' : ''}`,
        )
      }
      const orphans = slugs.filter((s) => inbound.get(s)?.size === 0)
      if (orphans.length && slugs.length > 1) {
        console.log(
          `\n${orphans.length} of ${slugs.length} slugs have no inbound link. A new post should ` +
            'earn one from an existing post, not only hand them out.',
        )
      }
    }

    console.log(
      `\nconventions: ${corpus.files.length} file(s) across ${corpus.locales.length} locale(s), ` +
        `${errors.length} error(s), ${warnings.length} warning(s), min_internal_links=${floor} ` +
        `(${corpus.bySlug.size} post(s) on disk)`,
    )
    results.push({ name: 'conventions', errors, warnings })
  }

  if (wanted('assets')) {
    banner('images')
    const { errors, warnings, checked } = gates.assets(corpus)
    report(errors, warnings)
    console.log(
      `\nimages: ${checked} image reference(s) across ${corpus.locales.length} locale(s), ` +
        `${errors.length} error(s), ${warnings.length} warning(s)`,
    )
    results.push({ name: 'images', errors, warnings })
  }

  if (wanted('backlog')) {
    banner('backlog')
    const backlog = backlogLib.load()
    if (!backlog) {
      // content/ideas/backlog.json is gitignored, so it does not exist on a fresh CI checkout.
      console.log('SKIP  content/ideas/backlog.json does not exist on this checkout')
      results.push({ name: 'backlog', errors: [], warnings: [], skipped: true })
    } else {
      const { errors, warnings } = backlogLib.validate(backlog, corpus)
      report(errors, warnings)
      console.log(
        `\nbacklog: ${backlog.items.length} item(s), ${errors.length} error(s), ` +
          `${warnings.length} warning(s)`,
      )
      results.push({ name: 'backlog', errors, warnings })
    }
  }

  const spread = gates.distribution(corpus)
  if (spread) {
    banner('corpus distribution (reported, not enforced)')
    console.log(
      `  words:  min ${spread.words.min}  median ${spread.words.median}  max ${spread.words.max}`,
    )
    console.log(`  H2:     min ${spread.h2.min}  median ${spread.h2.median}  max ${spread.h2.max}`)
    console.log('\nSet a real band in blog.config.json once these numbers mean something.')
  }

  banner('summary')
  let failed = 0
  for (const r of results) {
    const count = strict ? r.errors.length + r.warnings.length : r.errors.length
    if (count > 0) failed++
    console.log(`  ${r.skipped ? 'skip' : count > 0 ? 'FAIL' : 'pass'}  ${r.name}`)
  }
  console.log(
    failed > 0
      ? `\n${failed} gate(s) failed.${strict ? ' (--strict: warnings count as errors)' : ''}`
      : '\nblog check passed. Still owed by hand: a human reading the post.',
  )
  return failed > 0 ? 1 : 0
}

function report(errors, warnings) {
  for (const w of warnings) console.warn(`warn  ${w}`)
  for (const e of errors) console.error(`ERROR ${e}`)
}

const COMMANDS = { status, scan, extract, idea, add, set, note, check }

const [command, ...argv] = process.argv.slice(2)

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(USAGE)
  process.exit(0)
}
// No command is the orienting question: what should I do next?
if (!command) process.exit(await status([]))
if (!COMMANDS[command]) {
  console.error(`unknown command "${command}"\n\n${USAGE}`)
  process.exit(2)
}

try {
  process.exit(await COMMANDS[command](argv))
} catch (err) {
  console.error(`blog ${command}: ${err.message}`)
  process.exit(1)
}
