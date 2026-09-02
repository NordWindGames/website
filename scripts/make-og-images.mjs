/**
 * Cuts the Open Graph sharing cards in public/og/ out of the HoldStrong key art.
 *
 * A one-off tool, not part of the build: run it by hand, commit the PNGs it
 * writes, and the site never touches it again. That is deliberate — it leans on
 * `sharp`, which is in node_modules only because Astro's image pipeline depends
 * on it. Adding it to package.json would make a production dependency out of a
 * tool that runs twice a year, so instead this script is allowed to stop working
 * one day; the committed images keep serving.
 *
 * Usage: node scripts/make-og-images.mjs
 *
 * Why 1200x630: it is what X, LinkedIn and Discord crop their large cards to.
 * The key art is 1024x559, so 1.83:1 against the target's 1.90:1 — close enough
 * that fitting the width and trimming the height costs about 25px off the top
 * and bottom, well clear of the tower and the warrior.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'public/holdstrong/keyart.png')
const outDir = resolve(root, 'public/og')

const WIDTH = 1200
const HEIGHT = 630

/**
 * The studio card carries the wordmark, the game card does not.
 *
 * Without it both files would be the same crop of the same art, and two
 * identical bytes under two names is worse than one file used twice. The
 * wordmark is drawn as SVG text in a generic condensed sans rather than the
 * site's Silkscreen: the font has to come from whatever machine runs this, and
 * a missing family renders as a fallback instead of failing loudly.
 */
const wordmark = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#05070d" stop-opacity="0.92"/>
      <stop offset="55%" stop-color="#05070d" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#05070d" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${HEIGHT * 0.45}" width="${WIDTH}" height="${HEIGHT * 0.55}" fill="url(#scrim)"/>
  <text x="60" y="${HEIGHT - 96}" font-family="Impact, 'Arial Narrow', 'Barlow Condensed', sans-serif"
        font-size="76" font-weight="700" letter-spacing="6" fill="#f2f5fa">NORDWIND GAMES</text>
  <text x="64" y="${HEIGHT - 46}" font-family="'Segoe UI', Arial, sans-serif"
        font-size="30" letter-spacing="2" fill="#9fb2cc">HoldStrong: The Last Tower</text>
</svg>`

const crop = () => sharp(source).resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })

async function main() {
  await mkdir(outDir, { recursive: true })

  await crop()
    .composite([{ input: Buffer.from(wordmark), top: 0, left: 0 }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(resolve(outDir, 'nordwind.png'))

  await crop().png({ compressionLevel: 9, palette: true }).toFile(resolve(outDir, 'holdstrong.png'))

  for (const name of ['nordwind.png', 'holdstrong.png']) {
    const meta = await sharp(resolve(outDir, name)).metadata()
    console.log(`public/og/${name}: ${meta.width}x${meta.height}, ${meta.size} bytes`)
  }
}

await main()
