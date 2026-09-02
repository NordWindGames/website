// The event catalogue: every custom GA4 event this site may send, with its
// parameters typed. This map is the single source of truth — docs/analytics.md
// mirrors it for humans, and `track()` refuses anything not listed here.
//
// GA4 limits worth keeping in mind when extending this: event names ≤ 40 chars
// and snake_case, ≤ 25 parameters per event, parameter names ≤ 40 chars and
// values ≤ 100 chars. Never put personal data (email, name, raw user input)
// into a parameter — GA4 accounts get suspended for it, and the playtest
// signups already live in the Google Sheet.

import { compactParams, gtag, isTagPresent, type GtagParams } from './gtag';

/** Where on the page an element sits. Keep the set small so it stays groupable. */
export type Placement = 'header' | 'hero' | 'nav' | 'section' | 'footer' | 'overlay';

export type AnalyticsEvents = {
	// ---------------------------------------------------------------------
	// Site-wide. Emitted by the declarative layer in auto.ts, so any page that
	// renders <Analytics /> gets these without writing a listener.
	// ---------------------------------------------------------------------

	/** Any primary/secondary call to action was clicked. */
	cta_click: {
		cta_id: string;
		cta_location: Placement;
		cta_label?: string;
		link_url?: string;
		/** 1 for the first click in this page view, 2 for the second, … */
		click_index: number;
	};

	/** A link leaving nordwind.games was clicked (socials, store, Discord). */
	outbound_click: {
		link_id: string;
		link_domain: string;
		link_url: string;
		link_location: Placement;
	};

	/** A tracked section scrolled into view for the first time. */
	section_view: {
		section_id: string;
		section_index: number;
		/** Seconds between page load and the section becoming visible. */
		time_to_view_seconds: number;
	};

	/** Reading depth milestone. Finer-grained than GA4's built-in 90 % `scroll`. */
	scroll_depth: {
		percent_scrolled: 25 | 50 | 75 | 100;
	};

	/**
	 * Session-quality summary, sent on every end-of-attention signal: the tab
	 * being hidden, the page unloading, or a view transition swapping it out.
	 *
	 * A page view can therefore produce several of these — reports take the row
	 * with the highest `summary_index` (or the maximum of each metric) and never
	 * sum them. See docs/analytics.md.
	 */
	page_engagement: {
		engaged_time_seconds: number;
		max_scroll_percent: number;
		sections_viewed: number;
		interactions: number;
		exit_reason: 'hidden' | 'pagehide' | 'swap';
		/** 1 for the first summary of this page view, 2 for the next, … */
		summary_index: number;
	};

	// ---------------------------------------------------------------------
	// HoldStrong landing page.
	// ---------------------------------------------------------------------

	/** Steam wishlist intent — the highest-value pre-launch signal there is. */
	wishlist_click: {
		store: 'steam';
		placement: Placement;
	};

	/** User focused/typed into the playtest email field for the first time. */
	playtest_signup_start: {
		form_id: string;
	};

	/** Submit was pressed (fires for invalid input too — that is the point). */
	playtest_signup_submit: {
		form_id: string;
		attempt: number;
	};

	/** Signup accepted and handed to the storage endpoint. Key event. */
	playtest_signup_success: {
		form_id: string;
		/** Seconds between page load and the successful signup. */
		time_to_convert_seconds: number;
		attempt: number;
	};

	/**
	 * Signup rejected. No email or raw input is ever sent — only the reason.
	 *
	 * The three values are the three ways it can fail, and they point at
	 * different owners: 'invalid_email' is the visitor's typo (caught in the
	 * browser, nothing left the page), 'network_error' means the request never
	 * arrived — offline, timed out, or killed by an extension — and 'rejected'
	 * means it arrived and the storage endpoint refused it, which is ours to fix.
	 *
	 * A duplicate address is deliberately not in here. The endpoint recognises
	 * one and answers ok: the visitor is already signed up, which is a success
	 * for them, not an error.
	 */
	playtest_signup_error: {
		form_id: string;
		error_reason: 'invalid_email' | 'network_error' | 'rejected';
	};

	/**
	 * Which of the three gods pulls attention — a marketing/design signal.
	 *
	 * Odin is not among them: he grants no orb, so he has no card on the page.
	 */
	god_card_engage: {
		god_name: 'thor' | 'loki' | 'tyr';
		engage_type: 'dwell' | 'click';
	};

	/** Countdown block seen, with how far out the demo still is. */
	countdown_view: {
		days_to_demo: number;
	};

	// ---------------------------------------------------------------------
	// Declared but never emitted yet: nothing on the page carries them. The
	// gallery is placeholder blocks rather than images, there is no trailer, no
	// share button, and the demo ships on 16 October. They are typed up front
	// because GA4 collects nothing retroactively — a key event or custom
	// dimension only gathers data from the day it was registered.
	// ---------------------------------------------------------------------

	/** A screenshot/gallery slot was opened. */
	gallery_item_click: {
		gallery_slot: string;
		slot_index: number;
	};

	/** Trailer playback milestones once a trailer exists. */
	trailer_progress: {
		video_title: string;
		percent_played: 0 | 25 | 50 | 75 | 100;
	};

	/** Demo build download, per platform, once the demo ships. */
	demo_download_click: {
		platform: 'steam' | 'itch' | 'direct';
	};

	/** Native/social share of the page. */
	share_click: {
		method: string;
	};
};

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Send a custom event to GA4.
 *
 * Never throws: with no tag installed the call is dropped (and logged in dev),
 * so tracking can be sprinkled into handlers without try/catch noise.
 */
export function track<K extends AnalyticsEventName>(name: K, params: AnalyticsEvents[K]): void {
	const payload = compactParams(params as GtagParams);

	if (!isTagPresent()) {
		if (import.meta.env.DEV) console.debug('[analytics] (no tag)', name, payload);
		return;
	}

	if (import.meta.env.DEV) console.debug('[analytics]', name, payload);
	gtag('event', name, payload);
}

/**
 * Report a client-side navigation as a `page_view`.
 *
 * The tag sends this one itself for the initial document load
 * (`send_page_view`), but Astro's view transitions swap the DOM without a
 * document load — those navigations never reach GA4 unless we say so.
 *
 * Not part of the catalogue above: `page_view` is a GA4 built-in with reserved
 * parameter names, not one of our custom events.
 */
export function trackPageView(referrer?: string): void {
	const payload = compactParams({
		page_location: window.location.href,
		page_title: document.title,
		page_referrer: referrer,
	});

	if (!isTagPresent()) {
		if (import.meta.env.DEV) console.debug('[analytics] (no tag) page_view', payload);
		return;
	}

	if (import.meta.env.DEV) console.debug('[analytics] page_view', payload);
	gtag('event', 'page_view', payload);
}

/**
 * User-scoped dimensions, set once per page load. These describe the visitor's
 * environment, not the visitor — nothing here identifies a person.
 */
export type AnalyticsUserProperties = {
	/** mobile | tablet | desktop | wide — coarser and more stable than raw width. */
	viewport_bucket: 'mobile' | 'tablet' | 'desktop' | 'wide';
	/** Whether the visitor asked for reduced motion (this site is animation-heavy). */
	reduced_motion: 'true' | 'false';
	/** OS/browser colour scheme preference. */
	color_scheme: 'light' | 'dark';
	/** Whether the primary pointer is coarse — proxy for touch devices. */
	touch_primary: 'true' | 'false';
};

export function setUserProperties(props: AnalyticsUserProperties): void {
	if (import.meta.env.DEV) console.debug('[analytics] user_properties', props);
	gtag('set', 'user_properties', props);
}
