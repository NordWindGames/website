// Low-level bridge to the Google Analytics 4 tag.
//
// The tag itself is injected by src/components/Analytics.astro; everything in
// src/lib/analytics talks to it exclusively through this module, so the rest of
// the codebase never touches `window.gtag` and stays testable/no-op when the
// tag is absent (missing measurement ID, ad blocker, dev build).

export type GtagParams = Record<string, string | number | boolean | undefined>;

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

/** True once the GA4 tag has been installed on the page. */
export function isTagPresent(): boolean {
	return typeof window !== 'undefined' && typeof window.gtag === 'function';
}

/**
 * Forward a gtag command. Silently drops the call when no tag is installed —
 * an ad blocker or a missing measurement ID must never break the page.
 */
export function gtag(...args: unknown[]): void {
	if (typeof window === 'undefined') return;
	window.gtag?.(...args);
}

/** Strip `undefined` params so GA never records empty custom dimensions. */
export function compactParams(params: GtagParams): GtagParams {
	const out: GtagParams = {};
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}
