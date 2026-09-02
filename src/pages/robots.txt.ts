/**
 * robots.txt, generated so the domain is spelled once - in astro.config.mjs -
 * rather than a second time in a static public/robots.txt that nobody would
 * remember to update.
 *
 * Nothing here is disallowed for ordinary crawlers: the whole site is six public
 * pages. The value of the file is the Sitemap line (without Search Console
 * access it is the only way to announce a sitemap at all) and the stance below.
 *
 * On the AI stance. The devlog exists to be read and cited, including by
 * assistants, so the crawlers that fetch a page to answer a question right now
 * are welcome. The bulk collectors are not: CCBot feeds Common Crawl, which is
 * a training-corpus pipeline rather than a retrieval one, so blocking it costs
 * close to nothing in citability. Bytespider is the most aggressive crawler in
 * the field and does not reliably honour robots.txt anyway.
 *
 * Google-Extended and Applebot-Extended are not crawlers but opt-out tokens for
 * training and grounding. They are allowed on purpose: disallowing them would
 * not remove the site from AI Overviews - those draw on the ordinary search
 * index - it would only stop it being quoted with attribution.
 *
 * Worth remembering when editing this: robots.txt is a request, not
 * enforcement. GitHub Pages has no server-side hook to block a user agent that
 * ignores it.
 */
import type { APIRoute } from 'astro';

/** Crawlers that fetch a page to answer a question, and the training opt-out tokens. */
const RETRIEVAL_AGENTS = [
	'GPTBot',
	'OAI-SearchBot',
	'ChatGPT-User',
	'ClaudeBot',
	'Claude-User',
	'Claude-SearchBot',
	'PerplexityBot',
	'Perplexity-User',
	'Google-Extended',
	'Applebot-Extended',
	'DuckAssistBot',
	'meta-externalagent',
];

/** Bulk corpus collectors. */
const CORPUS_AGENTS = ['CCBot', 'Bytespider'];

export const GET: APIRoute = ({ site }) => {
	if (!site) {
		throw new Error('astro.config.mjs: `site` is required to announce the sitemap in robots.txt');
	}

	const lines = [
		'# https://nordwind.games/robots.txt',
		'# Generated from src/pages/robots.txt.ts - edit there, not here.',
		'',
		'User-agent: *',
		'Allow: /',
		'',
		'# Assistant retrieval crawlers: welcome. We would rather be quoted than invisible.',
		...RETRIEVAL_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
		'# Bulk training-corpus collectors: no. Blocking these costs little citability.',
		...CORPUS_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, 'Disallow: /', '']),
		`Sitemap: ${new URL('sitemap.xml', site).href}`,
		'',
	];

	return new Response(lines.join('\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
