/**
 * The studio's outbound links, in one place.
 *
 * Both the landing page and the blog footer render from this list, so a changed
 * URL is a one-line edit rather than a hunt through two components. The icons
 * live here too, as raw SVG markup, because a footer that had to re-declare them
 * would be the second copy of the same thing.
 *
 * Instrumentation is declarative (see src/lib/analytics/auto.ts): rendering an
 * anchor with data-analytics="outbound", data-analytics-id and
 * data-analytics-location is all an outbound_click event needs.
 */

export type SocialChannel = {
	/** Stable id, used as the analytics link_id. Keep it snake_case. */
	id: string;
	label: string;
	url: string;
	/** Inner markup of the icon, rendered into a 24x24 viewBox. */
	icon: string;
	/** Rendered icon edge length in px. X's glyph is optically larger, so it sits smaller. */
	size: number;
};

// TODO(nordwind): every url below is a placeholder pointing at the platform's
// own homepage - they went live that way. Replace each with the real profile
// URL. Anything still ending in a bare domain is a broken link in production.
export const SOCIAL_CHANNELS: SocialChannel[] = [
	{
		id: 'tiktok',
		label: 'TikTok',
		url: 'https://www.tiktok.com/',
		size: 19,
		icon: '<path d="M16.6 2h-2.9v12.1a2.4 2.4 0 1 1-2.4-2.4c.26 0 .5.04.74.12V9.1a5.1 5.1 0 1 0 4.36 5.05V8.2a6.1 6.1 0 0 0 3.6 1.16V6.6a3.6 3.6 0 0 1-3.4-3.5V2z" fill="currentColor"></path>',
	},
	{
		id: 'instagram',
		label: 'Instagram',
		url: 'https://www.instagram.com/',
		size: 19,
		icon:
			'<g fill="none" stroke="currentColor" stroke-width="1.8">' +
			'<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"></rect>' +
			'<circle cx="12" cy="12" r="4.1"></circle>' +
			'<circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" stroke="none"></circle>' +
			'</g>',
	},
	{
		id: 'discord',
		label: 'Discord',
		url: 'https://discord.com/',
		size: 19,
		icon: '<path d="M19.3 5.6A15.5 15.5 0 0 0 15.5 4.4l-.3.7a11.6 11.6 0 0 1 3.3 1.4 12.4 12.4 0 0 0-10.9 0 11.6 11.6 0 0 1 3.3-1.4l-.3-.7A15.5 15.5 0 0 0 4.7 5.6C2.4 9 1.8 12.4 2.1 15.7a15.3 15.3 0 0 0 4.7 2.3l.9-1.4a10 10 0 0 1-1.6-.8l.4-.3a11 11 0 0 0 9 0l.4.3a10 10 0 0 1-1.6.8l.9 1.4a15.3 15.3 0 0 0 4.7-2.3c.4-3.9-.6-7.3-2.6-10.1zM9.1 13.8c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm5.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z" fill="currentColor"></path>',
	},
	{
		id: 'x',
		label: 'X',
		url: 'https://x.com/',
		size: 17,
		icon: '<path d="M18.2 2.5h3.4l-7.4 8.5 8.1 10.5h-6.5l-4.6-6.1-5.3 6.1H2.5l7.7-8.9L2.4 2.5h6.6l4.3 5.7 4.9-5.7zm-1.2 17h1.9L7.1 4.4H5.1l11.9 15.1z" fill="currentColor"></path>',
	},
];

/**
 * Where the community actually talks, and where playtesters sign up.
 *
 * Kept separate from SOCIAL_CHANNELS because these two are destinations a post
 * links to in prose, not icons in a row.
 *
 * TODO(nordwind): both are placeholders. DISCORD_INVITE needs the real invite
 * (a discord.gg/... link, ideally one that does not expire), and PLAYTEST_SIGNUP
 * needs whatever form collects testers. Do not publish a post linking to either
 * until they are real.
 *
 * They point at the reserved .invalid TLD, which can never resolve. The four URLs
 * above went live pointing at platform homepages, so a click looked like it worked
 * and quietly went nowhere useful. A link that fails loudly beats one that lies.
 */
export const DISCORD_INVITE = 'https://REPLACE-ME.invalid/discord';
export const PLAYTEST_SIGNUP = 'https://REPLACE-ME.invalid/playtest-signup';
