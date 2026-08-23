// @ts-check
import { defineConfig } from 'astro/config';

// Served at https://nordwindgames.github.io/website/ until the custom domain is wired up.
// When the domain is added: set base to '/' and add a public/CNAME file.
export default defineConfig({
	site: 'https://nordwindgames.github.io',
	base: '/website/',
});
