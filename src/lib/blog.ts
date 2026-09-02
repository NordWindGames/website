import { getCollection, type CollectionEntry } from 'astro:content';

export type Locale = 'en' | 'de';

function localeOf(entry: CollectionEntry<'blog'>): string {
	return entry.id.split('/')[0];
}

function slugOf(entry: CollectionEntry<'blog'>): string {
	return entry.id.split('/').slice(1).join('/');
}

export async function getPostsByLocale(locale: Locale) {
	const all = await getCollection('blog');
	return all
		.filter((entry) => localeOf(entry) === locale)
		.map((entry) => ({ ...entry, slug: slugOf(entry) }))
		.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function otherLocale(locale: Locale): Locale {
	return locale === 'en' ? 'de' : 'en';
}

/**
 * URL builders. English is the unprefixed default locale (see astro.config.mjs),
 * German lives under /de/. Trailing slashes are deliberate: the build emits
 * directory-style output, so /blog/ is the file /blog/index.html.
 *
 * Every route that links into the devlog goes through these two rather than
 * interpolating the prefix itself — one place to change if the routing does.
 */
export function blogIndexPath(locale: Locale): string {
	return locale === 'en' ? '/blog/' : '/de/blog/';
}

export function postPath(locale: Locale, slug: string): string {
	return `${blogIndexPath(locale)}${slug}/`;
}

/**
 * The same post in the other locale, or null when it does not exist yet.
 *
 * Slugs are shared across locales (the same welcome.md name in both
 * src/content/blog/en and /de), so the translated URL is predictable — but only
 * for posts that actually exist. Guessing wrong on a static host is a hard 404:
 * GitHub Pages serves whatever file is at the path and has no rewrite to fall
 * back on. So we check the collection instead.
 *
 * Null rather than a fallback, because the two callers want opposite things
 * from a missing translation — see getTranslationPath below for the visible
 * switcher, and postAlternates in src/lib/seo.ts for the hreflang tags.
 */
export async function translatedPostPath(from: Locale, slug: string): Promise<string | null> {
	const to = otherLocale(from);
	const translated = await getPostsByLocale(to);
	return translated.some((post) => post.slug === slug) ? postPath(to, slug) : null;
}

/**
 * Where the language switcher points from a post: the same post in the other
 * locale, or that locale's index when the post has no translation yet.
 *
 * The fallback is the whole point here. A reader who clicks "Deutsch" wants
 * German, and the devlog index is the closest honest answer — better than a
 * dead link or a disabled control.
 *
 * hreflang must NOT use this. There the index fallback is a lie: it would
 * declare a different page as this page's German version, and a search engine
 * that spots the contradiction drops the whole language cluster rather than
 * just the bad entry.
 */
export async function getTranslationPath(from: Locale, slug: string): Promise<string> {
	return (await translatedPostPath(from, slug)) ?? blogIndexPath(otherLocale(from));
}

/**
 * The image a post opens with, pulled out of its raw markdown.
 *
 * The conventions gate enforces a hero image directly under the frontmatter
 * (require_hero_image in content/ideas/blog.config.json, checked by
 * scripts/lib/gates.mjs), so the first markdown image reference in the body is
 * the hero by construction. That guarantee is why this can be a regex over the
 * body instead of a frontmatter field every post would have to repeat.
 *
 * Returns null rather than throwing: a missing hero costs the post its
 * structured-data image, and that is not worth failing a build over.
 */
export function heroOf(body: string | undefined): { src: string; alt: string } | null {
	const match = body?.match(/!\[([^\]]*)\]\(([^)\s]+)\)/);
	return match ? { alt: match[1], src: match[2] } : null;
}
