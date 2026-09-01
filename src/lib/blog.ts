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
 * Where the language switcher points from a post: the same post in the other
 * locale, or that locale's index when the post has no translation yet.
 *
 * The fallback is the whole point. Slugs are shared across locales (the same
 * welcome.md name in both src/content/blog/en and /de), so the translated URL is
 * predictable — but only for posts that actually exist. Guessing wrong on a
 * static host is a hard 404: GitHub Pages serves whatever file is at the path
 * and has no rewrite to fall back on. So we check the collection instead.
 */
export async function getTranslationPath(from: Locale, slug: string): Promise<string> {
	const to = otherLocale(from);
	const translated = await getPostsByLocale(to);
	return translated.some((post) => post.slug === slug) ? postPath(to, slug) : blogIndexPath(to);
}
