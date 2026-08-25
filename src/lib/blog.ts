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
