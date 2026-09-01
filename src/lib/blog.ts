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
