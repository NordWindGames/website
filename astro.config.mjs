// @ts-check
import { defineConfig, envField } from 'astro/config';

export default defineConfig({
	site: 'https://nordwind.games',
	// Every emitted page is a directory (build.format defaults to 'directory', so /blog/
	// is the file /blog/index.html). Saying so explicitly makes "canonical URLs end in a
	// slash" a configuration decision rather than a coincidence, and makes the dev server
	// match as strictly as GitHub Pages does - a link missing its slash fails locally
	// instead of silently costing a redirect hop in production.
	trailingSlash: 'always',
	i18n: {
		// English is the site's base language (see src/pages/index.astro, lang="en"), so it
		// is the unprefixed default; German is the secondary, /de/-prefixed locale.
		defaultLocale: 'en',
		locales: ['en', 'de'],
		routing: {
			prefixDefaultLocale: false,
		},
	},
	env: {
		schema: {
			// GA4 measurement ID (G-XXXXXXXXXX). Inlined into the client bundle at build
			// time — public by design. When unset, no Google Analytics tag is rendered and
			// the analytics layer falls back to console logging in dev.
			PUBLIC_GA_MEASUREMENT_ID: envField.string({
				context: 'client',
				access: 'public',
				optional: true,
			}),
		},
	},
});
