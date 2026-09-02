/**
 * The devlog's RSS feed, one per locale.
 *
 * Hand-written rather than through @astrojs/rss, for the same reason the
 * sitemap is: it is thirty lines over data src/lib/blog.ts already hands out,
 * and both locales' routes are then one call each.
 *
 * Not an SEO feature - crawlers do not need it - but it is how a devlog reader
 * follows along without an account anywhere, and it shares this exact code path.
 */
import { getPostsByLocale, postPath, type Locale } from './blog';
import { SITE_NAME, blogIndex, feedPath } from './seo';

const escapeXml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function renderFeed(locale: Locale, site: URL): Promise<Response> {
	const index = blogIndex(locale);
	const posts = await getPostsByLocale(locale);
	const absolute = (path: string) => new URL(path, site).href;

	const items = posts.map((post) => {
		const url = absolute(postPath(locale, post.slug));
		return [
			'\t\t<item>',
			`\n\t\t\t<title>${escapeXml(post.data.title)}</title>`,
			`\n\t\t\t<link>${escapeXml(url)}</link>`,
			// The URL is the identity, so isPermaLink stays true: a reader that has
			// seen this guid has seen this post, whatever the title becomes later.
			`\n\t\t\t<guid isPermaLink="true">${escapeXml(url)}</guid>`,
			`\n\t\t\t<pubDate>${post.data.date.toUTCString()}</pubDate>`,
			`\n\t\t\t<description>${escapeXml(post.data.description)}</description>`,
			'\n\t\t</item>',
		].join('');
	});

	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
		'\t<channel>\n' +
		`\t\t<title>${escapeXml(`${SITE_NAME} Devlog`)}</title>\n` +
		`\t\t<link>${escapeXml(absolute(index.path))}</link>\n` +
		`\t\t<description>${escapeXml(index.description)}</description>\n` +
		`\t\t<language>${locale}</language>\n` +
		// Tells a reader where this feed actually lives, so a copy passed around
		// by file still knows its own address.
		`\t\t<atom:link href="${escapeXml(absolute(feedPath(locale)))}" rel="self" type="application/rss+xml" />\n` +
		(items.length > 0 ? `${items.join('\n')}\n` : '') +
		'\t</channel>\n' +
		'</rss>\n';

	return new Response(xml, {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
	});
}
