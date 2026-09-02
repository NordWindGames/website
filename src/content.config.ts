import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Frontmatter contract for devlog posts. `.strict()` makes an extra or misspelled
// field a build error instead of a silent drop — this schema is what the conventions gate in
// scripts/lib/gates.mjs defers to rather than re-declaring its own allowlist.
const blog = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
	schema: z
		.object({
			title: z.string(),
			description: z.string(),
			date: z.coerce.date(),
		})
		.strict(),
});

export const collections = { blog };
