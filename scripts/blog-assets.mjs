#!/usr/bin/env node
/**
 * Checks every image referenced by a devlog post before it goes live.
 * Deterministic, no network, no dependencies.
 *
 * Reads src/content/blog/<locale>/*.md and the files they point at under public/.
 *
 * Exit code 1 on any error, so it can be used as a gate.
 *
 * See docs/blog-automation.md and _port/blog-pipeline-port-devlog.md.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'content', 'ideas', 'blog.config.json'), 'utf8'))
const POSTS = join(ROOT, CONFIG.paths.posts_dir)
const PUBLIC = join(ROOT, CONFIG.paths.public_dir)

/**
 * existsSync() is case-insensitive on Windows and macOS, but the site is served
 * from Linux (GitHub Pages). A post referencing "step1_adresse.webp" for a file named
 * "step1_Adresse.webp" therefore renders fine locally and 404s in production.
 * Walk the path segment by segment and compare exactly.
 */
function existsCaseExact(src) {
  let dir = PUBLIC
  for (const segment of src.replace(/^\//, '').split('/')) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return false
    }
    if (!entries.includes(segment)) return false
    dir = join(dir, segment)
  }
  return true
}

/** Intrinsic pixel size of an SVG, viewBox first. */
function parseSvgIntrinsicSize(markup) {
  const openingTag = markup.match(/<svg\b[^>]*>/i)?.[0]
  if (!openingTag) return null

  const viewBox = openingTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }

  const width = Number(openingTag.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1])
  const height = Number(openingTag.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1])
  if (width > 0 && height > 0) return { width, height }

  return null
}

const errors = []
const warnings = []
let checked = 0

const locales = existsSync(POSTS)
  ? readdirSync(POSTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

for (const locale of locales) {
  for (const file of readdirSync(join(POSTS, locale)).filter((f) => f.endsWith('.md'))) {
    const where = `${CONFIG.paths.posts_dir}/${locale}/${file}`
    const body = readFileSync(join(POSTS, locale, file), 'utf8')

    for (const m of body.matchAll(/!\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g)) {
      const [, alt, src] = m
      checked++

      if (/^https?:\/\//i.test(src)) {
        warnings.push(`${where}: remote image, not checked - ${src}`)
        continue
      }

      if (!src.startsWith('/')) {
        errors.push(`${where}: image path must start with "/" (served from ${CONFIG.paths.public_dir}/) - ${src}`)
        continue
      }

      const filePath = join(PUBLIC, src.replace(/^\//, ''))
      if (!existsSync(filePath)) {
        errors.push(`${where}: image does not exist - ${CONFIG.paths.public_dir}${src}`)
        continue
      }
      if (!existsCaseExact(src)) {
        errors.push(
          `${where}: image path differs in case from the file on disk, which 404s on Linux - ` +
            `${CONFIG.paths.public_dir}${src}`
        )
        continue
      }

      if (!alt.trim()) {
        warnings.push(`${where}: image has no alt text - ${src}`)
      }

      if (!src.toLowerCase().endsWith('.svg')) continue

      const size = parseSvgIntrinsicSize(readFileSync(filePath, 'utf8'))
      if (!size) {
        errors.push(
          `${where}: SVG has no readable viewBox, so it does not scale responsively inside the ` +
            `fluid content column - ${CONFIG.paths.public_dir}${src}. Add viewBox="0 0 <w> <h>".`
        )
        continue
      }

      const ratio = size.width / size.height
      const { min, max } = CONFIG.assets.svg_ratio
      if (ratio < min || ratio > max) {
        warnings.push(
          `${where}: SVG aspect ratio ${ratio.toFixed(2)}:1 (${size.width}x${size.height}) is ` +
            `unusual for the ${CONFIG.assets.prose_width_px}px-wide prose column - ${CONFIG.paths.public_dir}${src}`
        )
      }
    }
  }
}

for (const w of warnings) console.warn(`warn  ${w}`)
for (const e of errors) console.error(`ERROR ${e}`)

console.log(
  `\nblog-assets: ${checked} image reference(s) across ${locales.length} locale(s), ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`
)

process.exit(errors.length > 0 ? 1 : 0)
