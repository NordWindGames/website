// Countdown to the public demo, and the playtest signup form.
// Submissions are stored via a Google Apps Script web app that appends rows to
// a Sheet — see scripts/google-apps-script/playtest-signup.gs for setup.

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
};

type SignupResult = { ok: true } | { ok: false; reason: 'unreachable' | 'rejected' };

const DEMO_TARGET = new Date('2026-10-16T10:00:00Z').getTime();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const REQUEST_TIMEOUT_MS = 15_000;

// Set after deploying scripts/google-apps-script/playtest-signup.gs as a web app.
const PLAYTEST_SIGNUP_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw8hzeMnWs00hsAvczc_6sXYWIMyNmFNoN86Fl3cgRLPtYfy7J9iat5HlCbxwRdXGRK/exec';

// Must match SHARED_TOKEN in scripts/google-apps-script/playtest-signup.gs.
// Not a real secret (it ships in the public JS bundle) — it only filters out
// scanners/bots that hit the URL directly without reading the page's JS.
const PLAYTEST_SIGNUP_TOKEN = 'zBqiE4MIi6OwJW3HU0MsiBaIZ5pxxbl7BrOtoAedRx590YLGeU064d5ZjyyKIJhK';

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

	els.form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		if (inFlight) return;

		const email = els.emailInput.value.trim();
		if (!EMAIL_RE.test(email)) {
			els.error.textContent = ERROR_MESSAGES.invalidEmail;
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
			return;
		}

		els.successEmail.textContent = email;
		els.form.hidden = true;
		els.success.hidden = false;
	});
}

export function initHoldStrong(els: Els) {
	startCountdown(els);
	bindSignupForm(els);
}
