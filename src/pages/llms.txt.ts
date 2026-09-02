/**
 * llms.txt: the site in a form an agent can read in one fetch.
 *
 * Honestly placed: no vendor is known to consume this file, and it may never be
 * read by anything. The case for it is that it costs ~30 lines, needs no
 * maintenance because it derives from the same registry the pages do, and pays
 * off the moment somebody points an agent at the domain directly.
 *
 * The ## Facts block is the actual point. Short, dated, self-contained
 * statements are what survives being chunked and retrieved out of context - a
 * paragraph of prose about how excited we are does not.
 *
 * No llms-full.txt. That would serve the entire post corpus a second time under
 * a second URL, which is duplicate content we would then have to fence off with
 * canonicals. Worth reconsidering somewhere north of twenty posts.
 */
import type { APIRoute } from 'astro';
import { getPostsByLocale, postPath, type Locale } from '../lib/blog';
import { DEMO_DATE, GAME_FULL_NAME, GAME_NAME, SITE_NAME, STATIC_PAGES, blogIndex } from '../lib/seo';
import { DISCORD_INVITE } from '../lib/social';

const LOCALE_HEADINGS: Record<Locale, string> = {
	en: 'Devlog (English)',
	de: 'Devlog (Deutsch)',
};

export const GET: APIRoute = async ({ site }) => {
	if (!site) {
		throw new Error('astro.config.mjs: `site` is required to build llms.txt');
	}

	const absolute = (path: string) => new URL(path, site).href;

	const sections: string[] = [
		`# ${SITE_NAME}`,
		'',
		`> Indie game studio in northern Germany, building ${GAME_FULL_NAME} — an incremental`,
		'> Viking roguelike tower defense for PC. Bilingual public devlog (English and German).',
		'',
		'## Facts',
		'',
		`- Studio: ${SITE_NAME}, Germany. One developer, Mathias.`,
		`- Game: ${GAME_FULL_NAME}, also written ${GAME_NAME}. It is the studio's first game.`,
		'- Genre: incremental roguelike tower defense, single player.',
		'- Setting: Rimehold, the last outpost before the Eternal Ice. You play an Einheri sent back at every dawn.',
		'- Platform: PC, via Steam.',
		`- Public demo: ${DEMO_DATE}, free on Steam. Playtest keys go out before that date.`,
		'- Not yet released. No launch date has been announced.',
		`- Community: ${DISCORD_INVITE}`,
		'',
		'## Pages',
		'',
		...STATIC_PAGES.map((page) => `- [${page.title}](${absolute(page.path)}): ${page.description}`),
		'',
	];

	for (const locale of ['en', 'de'] as Locale[]) {
		const index = blogIndex(locale);
		const posts = await getPostsByLocale(locale);

		sections.push(
			`## ${LOCALE_HEADINGS[locale]}`,
			'',
			`- [${index.title}](${absolute(index.path)}): ${index.description}`,
			...posts.map((post) => {
				const date = post.data.date.toISOString().slice(0, 10);
				return `- [${post.data.title}](${absolute(postPath(locale, post.slug))}): ${date} — ${post.data.description}`;
			}),
			'',
		);
	}

	return new Response(sections.join('\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
