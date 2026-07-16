# Google Sheets setup for MailMiner

MailMiner signs in with `chrome.identity.launchWebAuthFlow` (Google account picker).
The redirect URI is `https://<extension-id>.chromiumapp.org/` (from `chrome.identity.getRedirectURL()`).
No client secret is stored.

On a Google Sheets tab, MailMiner can:

1. **Read** the open spreadsheet via the Sheets API  
2. **Validate** emails through the validator API  
3. **Write** a Valid column back (when **Update current sheet** is checked)  
4. **Create** a new spreadsheet or a new blank worksheet with export results  

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).  
2. Create a project (or select an existing one).

## 2. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.  
2. Choose **External** (or Internal for Workspace-only).  
3. Fill in app name, support email, and developer contact.  
4. Add scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. If the app is in **Testing**, add every Google account that will use it under **Test users**.

## 3. Enable APIs

In **APIs & Services → Library**, enable:

- **Google Sheets API**  
- **Google Drive API**

## 4. Create OAuth credentials (Chrome Extension)

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.  
2. Application type: **Chrome Extension**.  
3. **Item ID**: your extension ID from `chrome://extensions` (must match exactly — required for the account picker redirect).  
4. Create the client and copy the **Client ID**.  
5. Put the **Chrome Extension** Client ID in `manifest.json` → `oauth2.client_id`, and the **Web application** Client ID (account picker) in `scripts/config.json` → `googleOauthClientId`.

If you reload an unpacked build and the extension ID changes, update the **Item ID** in Google Cloud to match.

### Error 400: redirect_uri_mismatch

This means the OAuth client’s **Item ID** does not equal the loaded extension’s ID.  
Copy the ID from `chrome://extensions`, paste it as Item ID, save, reload MailMiner, sign in again.

## 5. Load and test

1. Open `chrome://extensions` → **Load unpacked** → select the repo folder (the one with `manifest.json`).  
2. Confirm the extension ID matches the OAuth client **Item ID**.  
3. Open the MailMiner **popup** → **Sign in** → **Continue with Google** → pick an account.  
4. Open a Google Sheet that has an email column.  
5. Click **Scan current page** → **Validate & export**.  
6. With **Update current sheet** checked, refresh the sheet — a **Valid** column should appear beside the emails.  
7. With **New spreadsheet** checked, MailMiner opens a link to the created file after export.

## If scan / write fails with 403

1. Enable **Google Sheets API** and **Google Drive API** in the same Cloud project as your OAuth client.  
2. OAuth consent screen → if status is **Testing**, add your Google account under **Test users**.  
3. Sign out → sign in again from the popup.  
4. Confirm the OAuth Chrome Extension client's **Item ID** equals your extension ID.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| redirect_uri_mismatch | Set Cloud Console Item ID = extension ID from chrome://extensions. |
| Sign-in cancelled | User closed the Google window; try again. |
| Bad client / OAuth error | Client ID in manifest.json / config must match Cloud Console. |
| Session expired | Sign out and sign in again from the popup. |
| Access denied / API not enabled | Enable Sheets + Drive APIs; sign out/in. |
| No emails found | Ensure the active worksheet has an email column with data. |
| Cannot write Valid column | Need **Editor** access; or use **New spreadsheet** / **New blank sheet** instead. |

## Security notes

- Never put a client secret in the extension.  
- MailMiner stores the access token and profile in `chrome.storage.local` after picker sign-in.  
- Do not commit `scripts/config.local.json` if it contains private endpoints or keys.
