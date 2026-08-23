// @ts-check
import { defineConfig, envField } from 'astro/config';

export default defineConfig({
	site: 'https://nordwind.games',
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
