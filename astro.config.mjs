// @ts-check
import { defineConfig, envField } from 'astro/config';

export default defineConfig({
	site: 'https://nordwind.games',
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
