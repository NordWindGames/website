/**
 * The site's SEO surface in one place: canonical URLs, hreflang pairs, sharing
 * images, and the list of pages that are not driven by a content collection.
 *
 * Four consumers read from here — src/components/Seo.astro, and the
 * src/pages/sitemap.xml.ts, robots.txt.ts and llms.txt.ts endpoints. That is why
 * the titles and descriptions of the two standalone pages live in this file
 * rather than inline in their .astro files: a sitemap or an llms.txt that
 * repeated them would be maintaining a second copy that drifts on the first
 * edit nobody thinks to mirror.
 */
import { blogIndexPath, postPath, translatedPostPath, type Locale } from './blog';

export const SITE_NAME = 'Nordwind Games';

/**
 * One spelling each, everywhere. "Hold Strong" with a space is the same game and
 * costs search engines and language models the entity match, so the short name
 * is the canonical one and the long one goes into schema.org's alternateName.
 */
export const GAME_NAME = 'HoldStrong';
export const GAME_FULL_NAME = 'HoldStrong: The Last Tower';

/** The public demo date, as shown on the game page and counted down to in src/scripts/holdstrong.ts. */
export const DEMO_DATE = '2026-10-16';

export type OgImage = { src: string; width: number; height: number; alt: string };

/**
 * The sharing card for any page that does not bring its own.
 *
 * 1200×630 is what X, LinkedIn and Discord all crop to; anything smaller gets
 * upscaled. See scripts/make-og-images.mjs for how these are cut from the key art.
 */
export const OG_DEFAULT: OgImage = {
	src: '/og/nordwind.png',
	width: 1200,
	height: 630,
	alt: `${SITE_NAME} — ${GAME_FULL_NAME} key art: a rune-carved tower under a lightning storm, one warrior standing before it`,
};

/** The game page's own card: the same key art without the studio wordmark over it. */
export const OG_HOLDSTRONG: OgImage = {
	...OG_DEFAULT,
	src: '/og/holdstrong.png',
	alt: `${GAME_FULL_NAME} key art: a rune-carved tower under a lightning storm, one warrior standing before it`,
};

export type StaticPage = { path: string; title: string; description: string };

/**
 * The two deliberately English-only pages. There is no src/pages/de/index.astro
 * and no German game page, so neither of these may carry an hreflang cluster —
 * declaring a /de/ alternate that 404s is worse than declaring none.
 */
export const HOME: StaticPage = {
	path: '/',
	title: 'Nordwind Games — indie game studio',
	description: `${SITE_NAME} is an indie game studio in northern Germany, building ${GAME_FULL_NAME} — an incremental Viking roguelike tower defense for PC.`,
};

export const HOLDSTRONG: StaticPage = {
	path: '/holdstrong/',
	title: `${GAME_FULL_NAME} — ${SITE_NAME}`,
	description: `${GAME_NAME} is an incremental Viking roguelike tower defense by ${SITE_NAME}. The free demo lands on Steam on 16 October 2026; playtest keys go out before that.`,
};

export const STATIC_PAGES: StaticPage[] = [HOME, HOLDSTRONG];

/** The devlog index, per locale. Titles and descriptions match the two index routes. */
export function blogIndex(locale: Locale): StaticPage {
	return locale === 'de'
		? {
				path: blogIndexPath('de'),
				title: `Devlog — ${SITE_NAME}`,
				description: `Entwicklungsfortschritt und Learnings von ${SITE_NAME}.`,
			}
		: {
				path: blogIndexPath('en'),
				title: `Devlog — ${SITE_NAME}`,
				description: `Development progress and learnings from ${SITE_NAME}.`,
			};
}

/** A site-relative path as an absolute URL. Absolute input passes through untouched. */
export function absoluteUrl(path: string, site: URL): string {
	return /^https?:\/\//i.test(path) ? path : new URL(path, site).href;
}

/**
 * The one canonical spelling of a URL: absolute, exactly one trailing slash.
 *
 * Normalises defensively instead of trusting Astro.url.pathname to always end in
 * a slash — trailingSlash and build.format are two separate options, and
 * /404.html has no slash form at all. A path with a file extension keeps it.
 */
export function canonicalUrl(url: URL, site: URL): string {
	const hasExtension = /\.[a-z0-9]+$/i.test(url.pathname);
	const path = hasExtension ? url.pathname : url.pathname.replace(/\/*$/, '/');
	return new URL(path, site).href;
}

export type Alternate = { hreflang: string; href: string };

/**
 * en + de + x-default for a path that exists in both locales.
 *
 * x-default is what a visitor gets when their language is neither; English is
 * the site's base language (astro.config.mjs, defaultLocale), so it takes that
 * slot. Every cluster also names itself — a page must list its own hreflang, or
 * search engines treat the annotation as one-sided and ignore it.
 */
function pair(en: string, de: string): Alternate[] {
	return [
		{ hreflang: 'en', href: en },
		{ hreflang: 'de', href: de },
		{ hreflang: 'x-default', href: en },
	];
}

export const BLOG_INDEX_ALTERNATES: Alternate[] = pair(blogIndexPath('en'), blogIndexPath('de'));

/**
 * The hreflang cluster for a post, or nothing at all when it has no translation
 * yet. Half a cluster is worse than none: pointing hreflang="de" at the German
 * index would declare a different page as this post's translation.
 */
export async function postAlternates(locale: Locale, slug: string): Promise<Alternate[]> {
	const other = await translatedPostPath(locale, slug);
	if (!other) return [];
	const own = postPath(locale, slug);
	return locale === 'en' ? pair(own, other) : pair(other, own);
}

/** The RSS feed for a locale, linked from the devlog routes. */
export function feedPath(locale: Locale): string {
	return locale === 'de' ? '/de/rss.xml' : '/rss.xml';
}
