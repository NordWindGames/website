// Google Apps Script web app that appends playtest signup emails to a Sheet.
//
// Setup:
// 1. Create a Google Sheet (e.g. "HoldStrong Playtest Signups") with a header
//    row: Timestamp | Email
// 2. In the Sheet, open Extensions > Apps Script, delete the placeholder code
//    and paste this file's contents. Save.
// 3. Deploy > New deployment > select type "Web app".
//    - Execute as: Me
//    - Who has access: Anyone
// 4. Authorize the script when prompted (it only needs access to this Sheet).
// 5. Copy the deployment URL and set it as PLAYTEST_SIGNUP_ENDPOINT in
//    src/scripts/holdstrong.ts.
//
// Re-deploy (Deploy > Manage deployments > edit > new version) whenever you
// change this script — editing the code alone doesn't update the live URL.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function doPost(e) {
	const email = ((e.parameter && e.parameter.email) || '').trim();

	if (!EMAIL_RE.test(email)) {
		return ContentService.createTextOutput('invalid email');
	}

	const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
	sheet.appendRow([new Date(), email]);

	return ContentService.createTextOutput('ok');
}
