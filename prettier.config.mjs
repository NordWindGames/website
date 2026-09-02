/**
 * Formatting for this repo, tuned to the code that was already here rather than
 * to Prettier's defaults - the point is to lock the existing style in, not to
 * reformat everything into a different one.
 *
 * The two non-obvious ones:
 *
 * - endOfLine 'auto'. The files are stored LF in git, but git's autocrlf hands
 *   Windows checkouts CRLF. 'lf' would mark every file as unformatted on
 *   Windows and 'crlf' would do the same on the Linux CI runner; 'auto' takes
 *   each file's first line ending as its rule, so the same check passes on both.
 *
 * - printWidth 110. The .astro files carry long attribute lists on one line;
 *   at Prettier's default 80 they would all explode into one-attribute-per-line
 *   markup, which is a large diff for no readability gain.
 */
export default {
	plugins: ['prettier-plugin-astro'],
	useTabs: true,
	tabWidth: 2,
	printWidth: 110,
	singleQuote: true,
	semi: true,
	trailingComma: 'all',
	endOfLine: 'auto',
	overrides: [
		// The blog CLI under scripts/ was written in a different house style than
		// src/: two spaces and no semicolons. Nothing there is shared with the site
		// code, so it keeps its own shape rather than eating a 3000-line reformat.
		{
			files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
			options: { useTabs: false, tabWidth: 2, semi: false, printWidth: 100 },
		},
		// Tabs in a fenced code block or a table render as full-width indents on
		// GitHub, and JSON has no tab convention worth fighting for.
		{ files: ['*.md', '*.json'], options: { useTabs: false, tabWidth: 2 } },
	],
};
