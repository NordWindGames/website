/**
 * The sitemap, derived from the same registry the pages' head tags read from.
 *
 * Written by hand rather than through @astrojs/sitemap, for one reason: the
 * hreflang pairs have to exist as <link rel="alternate"> in each page's head
 * anyway. The integration would keep its own copy of that logic in node_modules
 * with slightly different semantics (no x-default), so a page and the sitemap
 * could disagree about the same cluster. Here both read postAlternates() in
 * src/lib/seo.ts. Per-URL lastmod comes free as a side effect - the integration
 * only takes one date for the whole file, or a serialize() hook that would have
 * to re-read frontmatter from disk since astro:content is not available in the
 * config.
 *
 * The cost of hand-writing it is that a new static page could be forgotten -
 * see assertNoUnlistedPages below.
 */
import type { APIRoute } from 'astro';
import { blogIndexPath, getPostsByLocale, postPath, type Locale } from '../lib/blog';
import { BLOG_INDEX_ALTERNATES, STATIC_PAGES, postAlternates, type Alternate } from '../lib/seo';

type Entry = { path: string; lastmod?: Date; alternates?: Alternate[] };

const LOCALES: Locale[] = ['en', 'de'];

const escapeXml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** <lastmod> takes a date; the time of day is noise we do not have anyway. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Every route worth indexing.
 *
 * 404.astro is absent by construction rather than filtered out: an error page
 * belongs in no index, so it never becomes an entry in the first place.
 *
 * No <changefreq> and no <priority>. Google ignores both, and with six URLs
 * there is nothing for a priority to rank. Leaving them out is the decision,
 * not an oversight.
 */
async function collectEntries(): Promise<Entry[]> {
	const entries: Entry[] = STATIC_PAGES.map((page) => ({ path: page.path }));

	for (const locale of LOCALES) {
		const posts = await getPostsByLocale(locale);

		// getPostsByLocale sorts newest first, so posts[0] dates the index: that
		// page changes every time a post is published, which is exactly what
		// lastmod is meant to say.
		entries.push({
			path: blogIndexPath(locale),
			lastmod: posts[0]?.data.date,
			alternates: BLOG_INDEX_ALTERNATES,
		});

		for (const post of posts) {
			entries.push({
				path: postPath(locale, post.slug),
				lastmod: post.data.date,
				alternates: await postAlternates(locale, post.slug),
			});
		}
	}

	return entries;
}

/**
 * Fails the build when a page under src/pages/ is missing from the sitemap.
 *
 * This is the guard that makes a hand-written sitemap safe to keep. import.meta.glob
 * resolves the file list at build time, so a new route that nobody added to
 * STATIC_PAGES stops the build instead of quietly never being crawled. Same
 * stance as the devlog gates in scripts/lib/gates.mjs: fail loudly rather than
 * drift silently.
 *
 * Dynamic routes are skipped - their URLs come from the content collection, not
 * from the filename - as is 404.astro, which is deliberately excluded.
 */
function assertNoUnlistedPages(listed: Set<string>): void {
	const pages = import.meta.glob('./**/*.astro', { eager: false });

	const unlisted = Object.keys(pages)
		.filter((file) => !file.includes('[') && !file.endsWith('/404.astro'))
		.map((file) =>
			file
				.replace(/^\./, '')
				.replace(/index\.astro$/, '')
				.replace(/\.astro$/, '/'),
		)
		.filter((path) => !listed.has(path));

	if (unlisted.length > 0) {
		throw new Error(
			`sitemap.xml: page route(s) ${unlisted.join(', ')} are not in the sitemap. ` +
				`Add them to STATIC_PAGES in src/lib/seo.ts, or exclude them here on purpose.`,
		);
	}
}

export const GET: APIRoute = async ({ site }) => {
	// `site` comes from astro.config.mjs. Without it there are no absolute URLs
	// and so no valid sitemap - a misconfiguration, not a case to degrade over.
	if (!site) {
		throw new Error('astro.config.mjs: `site` is required to build a sitemap');
	}

	const entries = await collectEntries();
	assertNoUnlistedPages(new Set(entries.map((entry) => entry.path)));

	const urls = entries.map((entry) => {
		const alternates = (entry.alternates ?? []).map(
			(alternate) =>
				`\n\t\t<xhtml:link rel="alternate" hreflang="${alternate.hreflang}" href="${escapeXml(
					new URL(alternate.href, site).href,
				)}" />`,
		);

		return [
			'\t<url>',
			`\n\t\t<loc>${escapeXml(new URL(entry.path, site).href)}</loc>`,
			entry.lastmod ? `\n\t\t<lastmod>${isoDay(entry.lastmod)}</lastmod>` : '',
			alternates.join(''),
			'\n\t</url>',
		].join('');
	});

	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
		'        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
		`${urls.join('\n')}\n` +
		'</urlset>\n';

	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
