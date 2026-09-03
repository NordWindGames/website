// Countdown to the public demo, and the playtest signup form.
// Submissions are stored via a Google Apps Script web app that appends rows to
// a Sheet — see scripts/google-apps-script/playtest-signup.gs for setup.
//
// This file also holds the page's analytics call sites. Everything expressible
// as markup is instrumented with data-analytics attributes instead (see
// src/lib/analytics/auto.ts); what is left here are the things an attribute
// cannot say: a form funnel, a dwell timer, and a value read off the clock.

import { track } from '../lib/analytics';

type God = 'thor' | 'loki' | 'tyr';

type Els = {
	days: HTMLElement;
	hours: HTMLElement;
	minutes: HTMLElement;
	seconds: HTMLElement;
	form: HTMLFormElement;
	emailInput: HTMLInputElement;
	error: HTMLElement;
	success: HTMLElement;
	successEmail: HTMLElement;
	godCards: HTMLElement[];
	galleryScroll: HTMLElement | null;
	galleryDots: HTMLElement | null;
};

type SignupResult = { ok: true } | { ok: false; reason: 'unreachable' | 'rejected' };

const DEMO_TARGET = new Date('2026-10-16T10:00:00Z').getTime();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const REQUEST_TIMEOUT_MS = 15_000;

// Set after deploying scripts/google-apps-script/playtest-signup.gs as a web app.
const PLAYTEST_SIGNUP_ENDPOINT =
	'https://script.google.com/macros/s/AKfycbw8hzeMnWs00hsAvczc_6sXYWIMyNmFNoN86Fl3cgRLPtYfy7J9iat5HlCbxwRdXGRK/exec';

// Must match SHARED_TOKEN in scripts/google-apps-script/playtest-signup.gs.
// Not a real secret (it ships in the public JS bundle) — it only filters out
// scanners/bots that hit the URL directly without reading the page's JS.
const PLAYTEST_SIGNUP_TOKEN = 'zBqiE4MIi6OwJW3HU0MsiBaIZ5pxxbl7BrOtoAedRx590YLGeU064d5ZjyyKIJhK';

/** Identifies the funnel in GA4. One form on the site today; name it anyway. */
const FORM_ID = 'holdstrong_playtest';

/** A god card counts as engaged once it has held the viewport this long. */
const GOD_DWELL_MS = 2000;

/** Fraction of a card that must be visible for the dwell timer to run. */
const GOD_DWELL_RATIO = 0.6;

/** Below this the gallery is a carousel; above it, a grid. Mirrors the CSS. */
const CAROUSEL_QUERY = '(max-width: 639px)';

/** Fraction of a slide that must be showing before its dot lights up. */
const SLIDE_ACTIVE_RATIO = 0.6;

const GODS: readonly God[] = ['thor', 'loki', 'tyr'];

/** The wire-level failure names, mapped onto the catalogue's error_reason values. */
const ERROR_REASON = {
	unreachable: 'network_error',
	rejected: 'rejected',
} as const;

const ERROR_MESSAGES = {
	invalidEmail: "That raven won't find its way — check the address.",
	// Nothing left the browser: offline, timed out, or blocked by an extension.
	unreachable: 'The raven never took off. Check your connection or an ad blocker, then try again.',
	// The request arrived but the web app refused it or answered unexpectedly.
	rejected: "The hall didn't answer. Please try again in a moment.",
} as const;

function pad(n: number) {
	return String(n).padStart(2, '0');
}

const isGod = (value: string | undefined): value is God => GODS.includes(value as God);

function startCountdown(els: Pick<Els, 'days' | 'hours' | 'minutes' | 'seconds'>) {
	const tick = () => {
		const remaining = Math.max(0, DEMO_TARGET - Date.now());
		els.days.textContent = String(Math.floor(remaining / 86_400_000));
		els.hours.textContent = pad(Math.floor(remaining / 3_600_000) % 24);
		els.minutes.textContent = pad(Math.floor(remaining / 60_000) % 60);
		els.seconds.textContent = pad(Math.floor(remaining / 1000) % 60);
	};
	tick();
	setInterval(tick, 1000);
}

// The Apps Script web app answers with a 302 to script.googleusercontent.com,
// and BOTH that redirect and the final response carry `Access-Control-Allow-Origin: *`.
// A urlencoded body keeps this a simple request (no preflight, which Apps Script
// could not answer), so a plain cors request goes through and — unlike `no-cors`,
// which yields an opaque response — lets us read whether the row was actually
// stored. Do not "fix" this back to no-cors: it would make every failure silent.
async function submitPlaytestSignup(email: string): Promise<SignupResult> {
	if (!PLAYTEST_SIGNUP_ENDPOINT) {
		console.warn('PLAYTEST_SIGNUP_ENDPOINT is not configured; signup was not stored.');
		return { ok: false, reason: 'rejected' };
	}

	let response: Response;
	let body: string;
	try {
		response = await fetch(PLAYTEST_SIGNUP_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ email, token: PLAYTEST_SIGNUP_TOKEN }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		body = (await response.text()).trim();
	} catch (err) {
		console.error('Playtest signup never reached the endpoint', err);
		return { ok: false, reason: 'unreachable' };
	}

	// doPost answers 'ok' only after the row was appended (or was already there).
	if (!response.ok || body !== 'ok') {
		console.error('Playtest signup was not stored', response.status, body);
		return { ok: false, reason: 'rejected' };
	}

	return { ok: true };
}

function bindSignupForm(els: Pick<Els, 'form' | 'emailInput' | 'error' | 'success' | 'successEmail'>) {
	const submitButton = els.form.querySelector('button[type="submit"]');
	const button = submitButton instanceof HTMLButtonElement ? submitButton : null;
	const buttonLabel = button?.textContent ?? '';
	let inFlight = false;
	let attempt = 0;
	let started = false;

	// Funnel entry. Focus and input both count: a browser filling the field from
	// autocomplete is as much an intent to sign up as typing into it is.
	const markStarted = () => {
		if (started) return;
		started = true;
		track('playtest_signup_start', { form_id: FORM_ID });
	};
	els.emailInput.addEventListener('focus', markStarted, { once: true });
	els.emailInput.addEventListener('input', markStarted, { once: true });

	els.form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		if (inFlight) return;

		attempt += 1;
		track('playtest_signup_submit', { form_id: FORM_ID, attempt });

		const email = els.emailInput.value.trim();
		if (!EMAIL_RE.test(email)) {
			els.error.textContent = ERROR_MESSAGES.invalidEmail;
			track('playtest_signup_error', { form_id: FORM_ID, error_reason: 'invalid_email' });
			return;
		}

		inFlight = true;
		els.error.textContent = '';
		if (button) {
			button.disabled = true;
			button.textContent = 'Sending…';
		}

		const result = await submitPlaytestSignup(email);

		inFlight = false;
		if (button) {
			button.disabled = false;
			button.textContent = buttonLabel;
		}

		// Only swap in the confirmation once the row is actually stored — the form
		// stays put on failure so the address is still there to retry with.
		if (!result.ok) {
			els.error.textContent = ERROR_MESSAGES[result.reason];
			track('playtest_signup_error', { form_id: FORM_ID, error_reason: ERROR_REASON[result.reason] });
			return;
		}

		// performance.now() is milliseconds since the navigation started, which is
		// exactly the "page load to conversion" the catalogue asks for.
		track('playtest_signup_success', {
			form_id: FORM_ID,
			time_to_convert_seconds: Math.round(performance.now() / 1000),
			attempt,
		});

		els.successEmail.textContent = email;
		els.form.hidden = true;
		els.success.hidden = false;
	});
}

/**
 * Which god holds attention, by dwell and by click.
 *
 * The cards are not links or buttons, so there is no href for the declarative
 * layer to turn into a cta_click - and a click on a card that goes nowhere is a
 * weak signal anyway. Dwell is the one that carries information: a card that
 * stayed on screen was read, and which of the three gets read is what the art
 * and marketing decisions hang on.
 *
 * The timer is cancelled when a card leaves the viewport, so scrolling past the
 * section at speed reports nothing.
 */
function bindGodCards(cards: HTMLElement[]) {
	for (const card of cards) {
		const god = card.dataset.god;
		if (!isGod(god)) continue;
		card.addEventListener('click', () => {
			track('god_card_engage', { god_name: god, engage_type: 'click' });
		});
	}

	if (typeof IntersectionObserver === 'undefined') return;

	const timers = new Map<Element, number>();
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const card = entry.target as HTMLElement;
				const god = card.dataset.god;
				if (!isGod(god)) continue;

				if (!entry.isIntersecting) {
					const pending = timers.get(card);
					if (pending !== undefined) {
						clearTimeout(pending);
						timers.delete(card);
					}
					continue;
				}

				timers.set(
					card,
					window.setTimeout(() => {
						timers.delete(card);
						// Once per page view: a second look at the same card is not a
						// second data point about which god is interesting.
						observer.unobserve(card);
						track('god_card_engage', { god_name: god, engage_type: 'dwell' });
					}, GOD_DWELL_MS),
				);
			}
		},
		{ threshold: GOD_DWELL_RATIO },
	);

	for (const card of cards) observer.observe(card);
}

/**
 * Light the dot belonging to the gallery slide currently on screen.
 *
 * Display only: the dots are aria-hidden and are never controls. On a touch
 * screen you swipe, you do not aim at a 7px target — and above the carousel
 * breakpoint there is no carousel to indicate, so the observer is torn down
 * rather than left running over a static grid.
 */
function bindGalleryCarousel(scroll: HTMLElement | null, dots: HTMLElement | null) {
	if (!scroll || !dots) return;
	if (typeof IntersectionObserver === 'undefined' || typeof matchMedia === 'undefined') return;

	const slides = Array.from(scroll.querySelectorAll<HTMLElement>('.hs-gallery-slot'));
	const marks = Array.from(dots.querySelectorAll<HTMLElement>('span'));
	if (slides.length === 0 || marks.length !== slides.length) return;

	let observer: IntersectionObserver | null = null;

	const attach = () => {
		if (observer) return;
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const index = slides.indexOf(entry.target as HTMLElement);
					if (index < 0) continue;
					for (const [i, mark] of marks.entries()) mark.toggleAttribute('data-active', i === index);
				}
			},
			{ root: scroll, threshold: SLIDE_ACTIVE_RATIO },
		);
		for (const slide of slides) observer.observe(slide);

		// A horizontal scroller is unreachable by keyboard in browsers that do not
		// focus scroll containers on their own, so say it is focusable — but only
		// while it actually scrolls.
		scroll.setAttribute('tabindex', '0');
		scroll.setAttribute('role', 'group');
		scroll.setAttribute('aria-label', 'Gallery, scrolls horizontally');
	};

	const detach = () => {
		observer?.disconnect();
		observer = null;
		for (const mark of marks) mark.removeAttribute('data-active');
		scroll.removeAttribute('tabindex');
		scroll.removeAttribute('role');
		scroll.removeAttribute('aria-label');
	};

	const mq = matchMedia(CAROUSEL_QUERY);
	const sync = () => (mq.matches ? attach() : detach());
	mq.addEventListener('change', sync);
	sync();
}

export function initHoldStrong(els: Els) {
	startCountdown(els);
	bindSignupForm(els);
	bindGodCards(els.godCards);
	bindGalleryCarousel(els.galleryScroll, els.galleryDots);
}
