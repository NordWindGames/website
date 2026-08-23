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

const DEMO_TARGET = new Date('2026-10-16T10:00:00Z').getTime();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

// Set after deploying scripts/google-apps-script/playtest-signup.gs as a web app.
const PLAYTEST_SIGNUP_ENDPOINT = '';

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

async function submitPlaytestSignup(email: string) {
	if (!PLAYTEST_SIGNUP_ENDPOINT) {
		console.warn('PLAYTEST_SIGNUP_ENDPOINT is not configured; signup was not stored.');
		return;
	}

	// Apps Script web apps don't send CORS headers for cross-origin requests,
	// so the response is opaque (mode: 'no-cors') — we can't read success/failure
	// from it, only detect network-level failures via the thrown exception below.
	await fetch(PLAYTEST_SIGNUP_ENDPOINT, {
		method: 'POST',
		mode: 'no-cors',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ email }),
	});
}

function bindSignupForm(els: Pick<Els, 'form' | 'emailInput' | 'error' | 'success' | 'successEmail'>) {
	els.form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		const email = els.emailInput.value.trim();
		if (!EMAIL_RE.test(email)) {
			els.error.textContent = "That raven won't find its way — check the address.";
			return;
		}
		els.error.textContent = '';
		els.successEmail.textContent = email;
		els.form.hidden = true;
		els.success.hidden = false;

		submitPlaytestSignup(email).catch((err) => {
			console.error('Playtest signup failed to send', err);
		});
	});
}

export function initHoldStrong(els: Els) {
	startCountdown(els);
	bindSignupForm(els);
}
