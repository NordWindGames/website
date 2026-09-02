// Declarative, page-agnostic instrumentation.
//
// Pages opt in through data attributes instead of hand-written listeners, so a
// new page (or a new button on an existing one) is tracked by adding markup —
// no analytics code to touch:
//
//   <a data-analytics="cta"      data-analytics-id="join_playtest"
//      data-analytics-location="hero">…</a>
//   <a data-analytics="outbound" data-analytics-id="discord"
//      data-analytics-location="footer" href="https://discord.com/…">…</a>
//   <section data-analytics-section="gods">…</section>
//
// On top of that this module always reports scroll depth and a per-page-view
// engagement summary.
//
// The module is split along one line: listeners on `document`/`window` are
// bound exactly once and read from the mutable `current` page view, while
// everything page-scoped (counters, scroll milestones, observed sections) is
// rebuilt by startPageView(). That is what makes Astro's view transitions
// work — they swap the DOM without a document load, so re-binding would
// double-count and not resetting would credit the new page's events to the old.

import { setUserProperties, track, trackPageView, type Placement } from './events';

const PLACEMENTS: readonly Placement[] = ['header', 'hero', 'nav', 'section', 'footer', 'overlay'];
const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** Fires a "section seen" once its top crosses 60 % of the viewport height. */
const SECTION_ROOT_MARGIN = '0px 0px -40% 0px';

function placementOf(el: Element): Placement {
	const raw = el.getAttribute('data-analytics-location');
	return PLACEMENTS.includes(raw as Placement) ? (raw as Placement) : 'section';
}

function labelOf(el: Element): string | undefined {
	const label = el.getAttribute('data-analytics-label') ?? el.textContent?.trim();
	// GA4 truncates parameter values at 100 chars; do it here so the value we
	// see in the debug log is the value that lands in the report.
	return label ? label.replace(/\s+/g, ' ').slice(0, 100) : undefined;
}

function hrefOf(el: Element): string | undefined {
	return el instanceof HTMLAnchorElement && el.href ? el.href : undefined;
}

// ---------------------------------------------------------------------------
// Per-page-view state
// ---------------------------------------------------------------------------

type PageView = {
	/** `origin + pathname + search` — a hash change is a jump, not a new page. */
	key: string;
	/** `performance.now()` at the start of this page view. */
	startedAt: number;
	/** Deepest scroll depth reached so far, in percent. */
	scrollMax: number;
	/** Milestones still waiting to be reported. */
	pendingMilestones: Set<number>;
	/** Clicks per CTA id, feeding `click_index`. */
	clickCounts: Map<string, number>;
	interactions: number;
	sectionsViewed: number;
	/** Disconnected when the page view ends, so a swapped-out DOM goes quiet. */
	sectionObserver: IntersectionObserver | null;
	/** 0 until the first engagement summary goes out. */
	summaryIndex: number;
	/** Fingerprint of the last summary sent, to drop identical repeats. */
	lastSummary: string | null;
};

let current: PageView | null = null;

function secondsIntoPageView(): number {
	return Math.round((performance.now() - (current?.startedAt ?? 0)) / 100) / 10;
}

// ---------------------------------------------------------------------------
// User-scoped dimensions
// ---------------------------------------------------------------------------

function viewportBucket(width: number) {
	if (width < 640) return 'mobile' as const;
	if (width < 1024) return 'tablet' as const;
	if (width < 1600) return 'desktop' as const;
	return 'wide' as const;
}

function reportUserProperties(): void {
	const matches = (query: string) => window.matchMedia?.(query).matches === true;
	setUserProperties({
		viewport_bucket: viewportBucket(window.innerWidth),
		reduced_motion: matches('(prefers-reduced-motion: reduce)') ? 'true' : 'false',
		color_scheme: matches('(prefers-color-scheme: dark)') ? 'dark' : 'light',
		touch_primary: matches('(pointer: coarse)') ? 'true' : 'false',
	});
}

// ---------------------------------------------------------------------------
// Engaged time
// ---------------------------------------------------------------------------

/**
 * Engaged time counts only while the tab is actually visible, which is what
 * "did this page hold attention" should mean — a page left open in a
 * background tab for an hour is not an hour of engagement.
 *
 * Bound once per document; reset() starts the next page view's clock.
 */
function createEngagementClock() {
	let accumulated = 0;
	let since = document.visibilityState === 'visible' ? performance.now() : null;

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			since ??= performance.now();
		} else if (since !== null) {
			accumulated += performance.now() - since;
			since = null;
		}
	});

	return {
		seconds: () => {
			const live = since === null ? 0 : performance.now() - since;
			return Math.round((accumulated + live) / 1000);
		},
		reset: () => {
			accumulated = 0;
			since = document.visibilityState === 'visible' ? performance.now() : null;
		},
	};
}

type EngagementClock = ReturnType<typeof createEngagementClock>;

// ---------------------------------------------------------------------------
// Clicks on annotated elements
// ---------------------------------------------------------------------------

function bindClicks(): void {
	// One delegated listener rather than one per element: elements added later
	// (or swapped in by a view transition) are covered without rebinding.
	document.addEventListener(
		'click',
		(event) => {
			if (!current) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			const el = target.closest<HTMLElement>('[data-analytics]');
			if (!el) return;

			const kind = el.getAttribute('data-analytics');
			const id = el.getAttribute('data-analytics-id');
			if (!id) return;

			current.interactions += 1;

			if (kind === 'outbound') {
				const url = hrefOf(el);
				if (!url) return;
				track('outbound_click', {
					link_id: id,
					link_domain: new URL(url).hostname,
					link_url: url,
					link_location: placementOf(el),
				});
				return;
			}

			if (kind === 'cta') {
				const clickIndex = (current.clickCounts.get(id) ?? 0) + 1;
				current.clickCounts.set(id, clickIndex);
				track('cta_click', {
					cta_id: id,
					cta_location: placementOf(el),
					cta_label: labelOf(el),
					link_url: hrefOf(el),
					click_index: clickIndex,
				});
			}
		},
		// Capture phase: the event is recorded even if a handler downstream
		// calls stopPropagation() or navigates away.
		{ capture: true },
	);
}

// ---------------------------------------------------------------------------
// Section visibility
// ---------------------------------------------------------------------------

function observeSections(view: PageView): void {
	const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-analytics-section]'));
	if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

	const indexOf = new Map(sections.map((el, index) => [el, index]));
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				observer.unobserve(el);
				// A callback that arrives after a view transition must not credit
				// the page view that has since replaced this one.
				if (current !== view) continue;
				view.sectionsViewed += 1;
				track('section_view', {
					section_id: el.getAttribute('data-analytics-section') ?? 'unknown',
					section_index: indexOf.get(el) ?? 0,
					time_to_view_seconds: secondsIntoPageView(),
				});
			}
		},
		{ rootMargin: SECTION_ROOT_MARGIN },
	);

	for (const section of sections) observer.observe(section);
	view.sectionObserver = observer;
}

// ---------------------------------------------------------------------------
// Scroll depth
// ---------------------------------------------------------------------------

function scrollPercent(): number {
	const scrollable = document.documentElement.scrollHeight - window.innerHeight;
	if (scrollable <= 1) return 100; // page fits the viewport — it was fully seen
	const ratio = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
	return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

function checkScroll(): void {
	if (!current) return;
	const percent = scrollPercent();
	if (percent > current.scrollMax) current.scrollMax = percent;

	// A page that never scrolls would otherwise report a bogus 100 % milestone.
	if (document.documentElement.scrollHeight - window.innerHeight <= 1) return;

	for (const milestone of SCROLL_MILESTONES) {
		if (percent >= milestone && current.pendingMilestones.delete(milestone)) {
			track('scroll_depth', { percent_scrolled: milestone });
		}
	}
}

function bindScrollDepth(): void {
	window.addEventListener('scroll', checkScroll, { passive: true });
	window.addEventListener('resize', checkScroll, { passive: true });
}

// ---------------------------------------------------------------------------
// Engagement summary
// ---------------------------------------------------------------------------

/**
 * Send the engagement summary for the current page view.
 *
 * This deliberately fires on *every* end-of-attention signal rather than
 * latching on the first one, because latching systematically undercounts: a
 * visitor who tabs away after three seconds and then comes back to read for
 * four minutes would be filed as a three-second visit. Each send carries an
 * incrementing `summary_index`, so reports take the highest index per page
 * view (or simply the maximum of each metric) instead of summing rows.
 */
function flushEngagement(exitReason: 'hidden' | 'pagehide' | 'swap', clock: EngagementClock): void {
	if (!current) return;

	const metrics = {
		engaged_time_seconds: clock.seconds(),
		max_scroll_percent: current.scrollMax,
		sections_viewed: current.sectionsViewed,
		interactions: current.interactions,
	};

	// `pagehide` straight after `visibilitychange` is simply how a desktop tab
	// closes; without this the same numbers would be reported twice.
	const fingerprint = Object.values(metrics).join('|');
	if (fingerprint === current.lastSummary) return;
	current.lastSummary = fingerprint;

	track('page_engagement', {
		...metrics,
		exit_reason: exitReason,
		summary_index: (current.summaryIndex += 1),
	});
}

function bindEngagementSummary(clock: EngagementClock): void {
	// `visibilitychange` is the only reliable end-of-page-view signal on mobile;
	// `pagehide` covers desktop reloads and same-tab navigations.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushEngagement('hidden', clock);
	});
	window.addEventListener('pagehide', () => flushEngagement('pagehide', clock));
}

// ---------------------------------------------------------------------------
// Page-view lifecycle
// ---------------------------------------------------------------------------

/** `origin + pathname + search`: a hash change jumps inside the same page view. */
function pageKey(): string {
	const { origin, pathname, search } = window.location;
	return `${origin}${pathname}${search}`;
}

function startPageView(clock: EngagementClock): void {
	current?.sectionObserver?.disconnect();
	clock.reset();

	const view: PageView = {
		key: pageKey(),
		startedAt: performance.now(),
		scrollMax: 0,
		pendingMilestones: new Set(SCROLL_MILESTONES),
		clickCounts: new Map(),
		interactions: 0,
		sectionsViewed: 0,
		sectionObserver: null,
		summaryIndex: 0,
		lastSummary: null,
	};
	current = view;

	observeSections(view);
	// Seeds scrollMax, and reports 100 % straight away for a page that fits.
	checkScroll();
}

/**
 * Astro's view transitions replace the DOM without a document load, so none of
 * the browser's own signals mark the boundary: `pagehide` never fires and
 * gtag's `send_page_view` only covers the initial load. Without these hooks the
 * first page view would keep accumulating for the rest of the visit and every
 * later navigation would be missing from GA4 entirely.
 *
 * Inert on a site that does not use <ClientRouter /> — the events never fire.
 */
function bindViewTransitions(clock: EngagementClock): void {
	document.addEventListener('astro:before-swap', () => flushEngagement('swap', clock));

	document.addEventListener('astro:page-load', () => {
		// Also fires for the initial document load, which initAnalytics() has
		// already opened a page view for.
		if (pageKey() === current?.key) return;
		trackPageView(current?.key);
		startPageView(clock);
	});
}

// ---------------------------------------------------------------------------

let initialised = false;

/**
 * Wire up every automatic tracker. Safe to call more than once (extra calls are
 * ignored) and safe to call when no GA4 tag is installed — events are then only
 * logged to the console in dev builds.
 */
export function initAnalytics(): void {
	if (typeof window === 'undefined' || initialised) return;
	initialised = true;

	// Describes the device, not the page — once per document is enough.
	reportUserProperties();

	// Bound for the lifetime of the document; everything page-scoped is
	// (re)built by startPageView() below and on every view transition.
	const clock = createEngagementClock();
	bindClicks();
	bindScrollDepth();
	bindEngagementSummary(clock);
	bindViewTransitions(clock);

	startPageView(clock);
}
