# Google Sheets setup for MailMiner

MailMiner uses the Chrome Identity API (`chrome.identity.getAuthToken`) with an OAuth 2.0 **Chrome Extension** client. No client secret is used or stored.

For the full product overview, see the main [README](../README.md).

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
3. **Item ID**: your extension ID from `chrome://extensions` (Developer mode → Load unpacked → copy the ID).  
4. Create the client and copy the **Client ID**.  
5. Put that Client ID in `manifest.json` under `oauth2.client_id`.

If you reload an unpacked build and the ID changes, update the Item ID in Google Cloud to match.

## 5. Load and test

1. Open `chrome://extensions` → **Load unpacked** → select the repo folder (the one with `manifest.json`).  
2. Confirm the extension ID matches the OAuth client Item ID.  
3. Open **MailMiner** → **Sign in** (or Settings) and approve Sheets access.  
4. Open a Google Sheet that has an email column.  
5. Click **Scan current page** → **Validate & export**.  
6. With **Update current sheet** checked, refresh the sheet — a **Valid** column should appear beside the emails.  
7. With **New spreadsheet** checked, MailMiner opens a link to the created file after export.

## If scan / write fails with 403

1. Enable **Google Sheets API** and **Google Drive API** in the same Cloud project as your OAuth client.  
2. OAuth consent screen → if status is **Testing**, add your Google account under **Test users**.  
3. Sign out → sign in again so Chrome re-grants Sheets scopes.  
4. Confirm the OAuth Chrome Extension client's **Item ID** equals your extension ID.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| Sign-in cancelled | User closed the consent dialog; try again. |
| Bad client / OAuth error | Extension ID in Cloud Console must match the loaded extension. |
| Session expired | Sign out and sign in again. |
| Access denied / API not enabled | Enable Sheets + Drive APIs; sign out/in. |
| Missing Google permission | Sign out/in and approve all scopes. |
| No emails found | Ensure the active worksheet has an email column with data. |
| Cannot write Valid column | Need **Editor** access; or use **New spreadsheet** / **New blank sheet** instead. |

## Security notes

- Never put a client secret in the extension.  
- Access tokens are cached by Chrome Identity; MailMiner only stores the account profile (name, email, picture) in `chrome.storage.local`.  
- Do not commit `scripts/config.local.js` if it contains private endpoints or keys.
