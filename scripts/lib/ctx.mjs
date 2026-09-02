/**
 * Shared context for the blog CLI: root, paths, config, JSON and date helpers, argv parsing.
 *
 * This replaces the prologue that used to be copy-pasted into all nine blog-*.mjs scripts,
 * along with two `flag()` implementations, two `daysSince` copies and three inline spellings
 * of `new Date().toISOString().slice(0, 10)`.
 *
 * Every optional config key gets a default here, so a command never crashes on a config that
 * simply does not mention something. The one hard requirement is paths.posts_dir - without it
 * there is no corpus and nothing downstream means anything.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The single place 'content/ideas' is spelled out. The config lives in that directory, so it
 * cannot also be the thing that declares where the directory is - the old blog.config.json had
 * a paths.ideas_dir key that eight scripts ignored in favour of hardcoding the same path.
 */
export const IDEAS = join(ROOT, 'content', 'ideas')

/** Repo-relative path with forward slashes, for messages that must read the same on every OS. */
export const rel = (abs) => relative(ROOT, abs).split(sep).join('/')

function loadConfig() {
  const file = join(IDEAS, 'blog.config.json')
  if (!existsSync(file)) throw new Error(`missing ${rel(file)}`)

  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw.paths?.posts_dir) throw new Error('blog.config.json: paths.posts_dir is required')

  return {
    brand: { name: '', domain: '', user_agent: 'blog-pipeline/1.0', ...raw.brand },
    paths: { public_dir: 'public', routes_dir: 'src/pages', ...raw.paths },
    locales: { list: ['en'], default: 'en', require_pairing: false, ...raw.locales },
    conventions: {
      require_hero_image: true,
      min_internal_links_ramp: [],
      ...raw.conventions,
    },
    assets: {
      svg_ratio: { min: 0, max: Number.POSITIVE_INFINITY },
      prose_width_px: 768,
      ...raw.assets,
    },
    scoring: {
      weights: { interest: 0.35, evidence: 0.25, ease: 0.2, durability: 0.2 },
      ...raw.scoring,
    },
    cadence_days: raw.cadence_days ?? 30,
  }
}

export const CONFIG = loadConfig()

export const POSTS_DIR = join(ROOT, CONFIG.paths.posts_dir)
export const PUBLIC_DIR = join(ROOT, CONFIG.paths.public_dir)
export const ROUTES_DIR = join(ROOT, CONFIG.paths.routes_dir)

/** Read a JSON file from content/ideas/, or null if it is not there. */
export function readIdeas(name) {
  const file = join(IDEAS, name)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

/**
 * Write a JSON file to content/ideas/. `compact` skips the indent: state.json is bookkeeping
 * nobody reads by hand, and indenting 327 URLs is what made the old seen.json 63 KB.
 */
export function writeIdeas(name, data, { compact = false } = {}) {
  const body = compact ? JSON.stringify(data) : `${JSON.stringify(data, null, 2)}\n`
  writeFileSync(join(IDEAS, name), body)
  return join(IDEAS, name)
}

export const today = () => new Date().toISOString().slice(0, 10)
export const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)

/**
 * argv parser for the subcommand surface: positionals, `--flag`, and `--key value` (values are
 * joined so `--reason "a b c"` survives a shell that split it).
 */
export function parseArgs(argv) {
  const positional = []
  const flags = new Set()
  const values = new Map()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    const collected = []
    while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) collected.push(argv[++i])
    if (collected.length) values.set(name, collected.join(' '))
    else flags.add(name)
  }

  return {
    positional,
    has: (name) => flags.has(name) || values.has(name),
    value: (name) => values.get(name) ?? null,
    /** Flag names that no command declared - a typo'd flag must not pass silently. */
    unknown: (known) => [...flags, ...values.keys()].filter((n) => !known.includes(n)),
  }
}
