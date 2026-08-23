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

import { setUserProperties, track, type Placement } from './events';

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

function secondsSinceLoad(): number {
	return Math.round(performance.now() / 100) / 10;
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
// Clicks on annotated elements
// ---------------------------------------------------------------------------

function bindClicks(onInteraction: () => void): void {
	// One delegated listener rather than one per element: elements added later
	// (or swapped out, like the signup form) are covered without rebinding.
	const clickCounts = new Map<string, number>();

	document.addEventListener(
		'click',
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const el = target.closest<HTMLElement>('[data-analytics]');
			if (!el) return;

			const kind = el.getAttribute('data-analytics');
			const id = el.getAttribute('data-analytics-id');
			if (!id) return;

			onInteraction();

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
				const clickIndex = (clickCounts.get(id) ?? 0) + 1;
				clickCounts.set(id, clickIndex);
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

function bindSectionViews(onSectionView: () => void): void {
	const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-analytics-section]'));
	if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

	const indexOf = new Map(sections.map((el, index) => [el, index]));
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				observer.unobserve(el);
				onSectionView();
				track('section_view', {
					section_id: el.getAttribute('data-analytics-section') ?? 'unknown',
					section_index: indexOf.get(el) ?? 0,
					time_to_view_seconds: secondsSinceLoad(),
				});
			}
		},
		{ rootMargin: SECTION_ROOT_MARGIN },
	);

	for (const section of sections) observer.observe(section);
}

// ---------------------------------------------------------------------------
// Scroll depth + engagement summary
// ---------------------------------------------------------------------------

type EngagementState = {
	maxScrollPercent: () => number;
	engagedSeconds: () => number;
	interactions: number;
	sectionsViewed: number;
};

function scrollPercent(): number {
	const scrollable = document.documentElement.scrollHeight - window.innerHeight;
	if (scrollable <= 1) return 100; // page fits the viewport — it was fully seen
	const ratio = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
	return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

function bindScrollDepth(state: { max: number }): void {
	const pending = new Set<number>(SCROLL_MILESTONES);
	// A page that never scrolls would otherwise report a bogus 100 % milestone.
	const scrollable = () => document.documentElement.scrollHeight - window.innerHeight > 1;

	const check = () => {
		const percent = scrollPercent();
		if (percent > state.max) state.max = percent;
		if (!scrollable()) return;
		for (const milestone of SCROLL_MILESTONES) {
			if (percent >= milestone && pending.delete(milestone)) {
				track('scroll_depth', { percent_scrolled: milestone });
			}
		}
	};

	check();
	window.addEventListener('scroll', check, { passive: true });
	window.addEventListener('resize', check, { passive: true });
}

/**
 * Engaged time counts only while the tab is actually visible, which is what
 * "did this page hold attention" should mean — a page left open in a
 * background tab for an hour is not an hour of engagement.
 */
function trackEngagedTime(): () => number {
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

	return () => {
		const live = since === null ? 0 : performance.now() - since;
		return Math.round((accumulated + live) / 1000);
	};
}

function bindEngagementSummary(state: EngagementState): void {
	let sent = false;
	const flush = (exitReason: 'hidden' | 'pagehide') => {
		if (sent) return;
		sent = true;
		track('page_engagement', {
			engaged_time_seconds: state.engagedSeconds(),
			max_scroll_percent: state.maxScrollPercent(),
			sections_viewed: state.sectionsViewed,
			interactions: state.interactions,
			exit_reason: exitReason,
		});
	};

	// `visibilitychange` is the only reliable end-of-page-view signal on mobile;
	// `pagehide` covers desktop reloads and same-tab navigations.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flush('hidden');
	});
	window.addEventListener('pagehide', () => flush('pagehide'));
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

	reportUserProperties();

	const scroll = { max: scrollPercent() };
	const engagedSeconds = trackEngagedTime();
	const state: EngagementState = {
		maxScrollPercent: () => scroll.max,
		engagedSeconds,
		interactions: 0,
		sectionsViewed: 0,
	};

	bindClicks(() => {
		state.interactions += 1;
	});
	bindSectionViews(() => {
		state.sectionsViewed += 1;
	});
	bindScrollDepth(scroll);
	bindEngagementSummary(state);
}
