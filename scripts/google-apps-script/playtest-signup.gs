// Google Apps Script web app that appends playtest signup emails to a Sheet.
//
// Setup:
// 1. Create a Google Sheet (e.g. "HoldStrong Playtest Signups") with a header
//    row: Timestamp | Email
// 2. In the Sheet, open Extensions > Apps Script, delete the placeholder code
//    and paste this file's contents. Save.
// 3. Pick your own value for SHARED_TOKEN below and set the matching
//    PLAYTEST_SIGNUP_TOKEN in src/scripts/holdstrong.ts. This is not a real
//    secret (it ships in the public JS bundle either way) — it only filters
//    out scanners/bots that hit the URL without reading the page's JS.
// 4. Deploy > New deployment > select type "Web app".
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Authorize the script when prompted (it only needs access to this Sheet).
// 6. Copy the deployment URL and set it as PLAYTEST_SIGNUP_ENDPOINT in
//    src/scripts/holdstrong.ts.
//
// Re-deploy (Deploy > Manage deployments > edit > new version) whenever you
// change this script — editing the code alone doesn't update the live URL.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const SHARED_TOKEN = 'CHANGE_ME';

// Google Sheets (and Excel/LibreOffice on CSV export) interpret a cell value
// starting with =, +, -, @, or a tab/CR as a formula. An email that starts
// with one of those characters would otherwise still pass EMAIL_RE and get
// executed as a formula by whoever later opens the sheet. Prefixing it with
// an apostrophe forces the cell to be read as plain text.
function sanitizeForSheet(value) {
	return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function doPost(e) {
	const params = e.parameter || {};

	if (params.token !== SHARED_TOKEN) {
		return ContentService.createTextOutput('unauthorized');
	}

	const email = (params.email || '').trim();

	if (!EMAIL_RE.test(email)) {
		return ContentService.createTextOutput('invalid email');
	}

	const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
	const lastRow = sheet.getLastRow();
	// Column B holds emails (see the sheet header set up in step 1 above).
	const existingEmails =
		lastRow > 1
			? sheet
					.getRange(2, 2, lastRow - 1, 1)
					.getValues()
					.flat()
					.map((value) => String(value).toLowerCase())
			: [];

	if (!existingEmails.includes(email.toLowerCase())) {
		sheet.appendRow([new Date(), sanitizeForSheet(email)]);
	}

	return ContentService.createTextOutput('ok');
}
