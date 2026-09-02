import type { APIRoute } from 'astro';
import { renderFeed } from '../lib/feed';

export const GET: APIRoute = ({ site }) => {
	if (!site) {
		throw new Error('astro.config.mjs: `site` is required to build the RSS feed');
	}
	return renderFeed('en', site);
};
