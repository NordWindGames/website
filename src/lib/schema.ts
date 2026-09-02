/**
 * The site as a schema.org graph: who the studio is, what the game is, and what
 * each devlog post says.
 *
 * This is the part of the SEO work aimed at assistants rather than at ranking.
 * A BlogPosting with datePublished, author and inLanguage is what lets an
 * assistant write "according to the Nordwind Games devlog from August 2026…";
 * a VideoGame with genre and gamePlatform makes "which Viking roguelikes are in
 * development" a question that can be answered from markup instead of guessed
 * from prose.
 *
 * Plain functions returning plain objects, with `site` passed in rather than
 * read from an Astro global, so the same nodes can be built from a page or from
 * an endpoint. Everything is stitched together as one @graph with @id
 * references: Organization is needed by the website, the game and every post,
 * and it has to be one entity rather than four with the same name.
 */
import { heroOf, type Locale } from './blog';
import {
	GAME_FULL_NAME,
	GAME_NAME,
	HOLDSTRONG,
	HOME,
	SITE_NAME,
	absoluteUrl,
	blogIndex,
	type StaticPage,
} from './seo';

type Node = Record<string, unknown>;

/** A stable @id for a node, so other nodes can reference it instead of repeating it. */
const nodeId = (site: URL, fragment: string) => new URL(fragment, site).href;

/**
 * The nodes every page repeats: the studio, and the person writing the devlog.
 *
 * Repeated rather than referenced from the landing page alone. The @id keeps
 * them one entity across the site either way, but a page that only carries
 * `author: { "@id": "…#mathias" }` says nothing on its own — and a retrieval
 * system that has fetched exactly one post is the normal case, not the edge
 * case. About 300 bytes per page to make each one self-describing.
 */
export function identityNodes(site: URL): Node[] {
	return [organization(site), person(site)];
}

const ORGANIZATION = '#organization';
const AUTHOR = '#mathias';

export function organization(site: URL): Node {
	return {
		'@type': 'Organization',
		'@id': nodeId(site, ORGANIZATION),
		name: SITE_NAME,
		url: site.href,
		description: HOME.description,
		// Country only. The studio is a person working from home; a street or city
		// would publish a home address to every crawler that reads this.
		address: { '@type': 'PostalAddress', addressCountry: 'DE' },
		// No `logo`: there is only favicon.svg/.ico, and Google wants a raster
		// image of at least 112x112. Add it here once public/logo-512.png exists.
		//
		// No `sameAs` either, and that one is a correctness issue rather than a
		// missing asset: every URL in src/lib/social.ts except Discord still
		// points at the platform's own homepage (see the TODO there). Listing
		// https://www.tiktok.com/ as sameAs claims the studio *is* TikTok. It goes
		// in as soon as the real profile URLs do.
	};
}

/**
 * The person writing the devlog, as the posts' author.
 *
 * First name only, matching how the posts sign themselves. A fuller name would
 * help entity matching, but that is the author's call to make, not a detail to
 * infer from a byline.
 */
export function person(site: URL): Node {
	return {
		'@type': 'Person',
		'@id': nodeId(site, AUTHOR),
		name: 'Mathias',
		worksFor: { '@id': nodeId(site, ORGANIZATION) },
	};
}

export function website(site: URL): Node {
	return {
		'@type': 'WebSite',
		'@id': nodeId(site, '#website'),
		name: SITE_NAME,
		url: site.href,
		inLanguage: ['en', 'de'],
		publisher: { '@id': nodeId(site, ORGANIZATION) },
		// No potentialAction/SearchAction: the site has no search.
	};
}

export function videoGame(site: URL): Node {
	return {
		'@type': 'VideoGame',
		'@id': nodeId(site, `${HOLDSTRONG.path}#game`),
		name: GAME_NAME,
		alternateName: GAME_FULL_NAME,
		url: absoluteUrl(HOLDSTRONG.path, site),
		description: HOLDSTRONG.description,
		image: absoluteUrl('/og/holdstrong.png', site),
		genre: ['Roguelike', 'Tower defense', 'Incremental game'],
		gamePlatform: 'PC',
		playMode: 'SinglePlayer',
		inLanguage: 'en',
		author: { '@id': nodeId(site, ORGANIZATION) },
		publisher: { '@id': nodeId(site, ORGANIZATION) },
		// No datePublished: 16 October 2026 is when the demo opens, not a release
		// date, and claiming otherwise would be wrong the moment it ships.
		//
		// No offers: the Steam links on the page are still href="#". An offer
		// pointing nowhere is worse than no offer.
	};
}

/** The @id of a locale's Blog node, so posts can declare which one they belong to. */
const blogId = (site: URL, locale: Locale) => nodeId(site, `${blogIndex(locale).path}#blog`);

export function blog(
	site: URL,
	locale: Locale,
	posts: { slug: string; data: { title: string } }[],
	postUrl: (slug: string) => string,
): Node {
	const page: StaticPage = blogIndex(locale);
	return {
		'@type': 'Blog',
		'@id': blogId(site, locale),
		name: `${SITE_NAME} Devlog`,
		url: absoluteUrl(page.path, site),
		description: page.description,
		inLanguage: locale,
		publisher: { '@id': nodeId(site, ORGANIZATION) },
		author: { '@id': nodeId(site, AUTHOR) },
		blogPost: posts.map((post) => ({
			'@type': 'BlogPosting',
			'@id': `${absoluteUrl(postUrl(post.slug), site)}#post`,
			headline: post.data.title,
			url: absoluteUrl(postUrl(post.slug), site),
		})),
	};
}

export function blogPosting(args: {
	site: URL;
	locale: Locale;
	path: string;
	title: string;
	description: string;
	date: Date;
	body?: string;
}): Node {
	const { site, locale, path, title, description, date, body } = args;
	const url = absoluteUrl(path, site);
	const hero = heroOf(body);

	return {
		'@type': 'BlogPosting',
		'@id': `${url}#post`,
		headline: title,
		description,
		url,
		mainEntityOfPage: { '@type': 'WebPage', '@id': url },
		datePublished: date.toISOString(),
		// No dateModified: the frontmatter has no `updated` field, and repeating
		// datePublished here would assert the post has never been touched since.
		inLanguage: locale,
		isPartOf: { '@id': blogId(site, locale) },
		author: { '@id': nodeId(site, AUTHOR) },
		publisher: { '@id': nodeId(site, ORGANIZATION) },
		...(hero ? { image: absoluteUrl(hero.src, site) } : {}),
	};
}

export function breadcrumbs(site: URL, items: { name: string; path: string }[]): Node {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: item.name,
			item: absoluteUrl(item.path, site),
		})),
	};
}

/** The trail every page below the landing page starts with. */
export const HOME_CRUMB = { name: SITE_NAME, path: HOME.path };
