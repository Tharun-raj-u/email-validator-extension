# MailMiner

**MailMiner** is a Chrome extension that finds email addresses on a page (or in pasted data), checks whether they look real, and lets you save the results as a file or into Google Sheets.

Think of it like a helper robot:

1. **Find** the emails  
2. **Check** them with a validator service  
3. **Deliver** the results where you want them

This guide explains how the app works end to end, how the pieces talk to each other, and how to load or deploy it.

---

## What you can do

| Action | What it means in plain words |
|--------|------------------------------|
| **Paste data** | Paste CSV / TSV / sheet rows into the popup and parse them |
| **Scan current page** | Read the open tab (best on Google Sheets) and find email columns |
| **OCR parse (images)** | Screenshot the sheet/grid area and read emails from pictures of text |
| **Validate & export** | Ask the validator API which emails are Valid / Invalid / Unknown, then export |
| **Sign in with Google** | Unlock reading/writing Google Sheets with your account |

---

## Quick start (load the extension)

You do **not** need `npm install` to run MailMiner. It is plain JavaScript + a Chrome manifest.

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Choose this folder: the one that contains `manifest.json`
5. Pin **MailMiner** from the extensions menu
6. Open the popup → **Sign in** (needed for Google Sheets features)

Your **extension ID** appears under the extension name on `chrome://extensions`. Google OAuth must use that same ID (see [Google Sheets setup](docs/google-sheets-setup.md)).

---

## How a normal session works (end to end)

```text
┌─────────────┐     messages      ┌──────────────────┐     HTTPS      ┌─────────────────┐
│  Popup UI   │ ───────────────► │ Background worker│ ─────────────► │ Validator API   │
│ (your face) │ ◄─────────────── │ (the brain)      │                │ OCR worker      │
└─────────────┘                   └────────┬─────────┘                │ Google APIs     │
                                           │ inject / read            └─────────────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │ Content scripts  │
                                  │ (eyes on the tab)│
                                  └──────────────────┘
```

### Step by step

1. **You open the popup**  
   The popup is the control panel (`popup/popup.html` + `popup.js`). It remembers your options (export format, delivery, column map) in Chrome storage.

2. **You bring in data** (pick one):
   - **Paste** → popup parses the text locally with `scripts/csv.js`
   - **Scan current page**  
     - If the tab is a Google Sheet URL **and** you are signed in → background calls the **Google Sheets API** and reads the live sheet  
     - Otherwise → background injects `sheets-bootstrap.js` + `content.js` into the tab so the extension can scrape the page DOM / embedded sheet data
   - **OCR parse** → popup screenshots the grid area, crops it, and asks the background to send the image to the **OCR worker**. OCR text is turned into a table of emails.

3. **You click Validate & export**  
   - Emails are sent in batches to the **validator API**  
   - Results become a map: `email → Valid | Invalid | Unknown`  
   - A **Valid** column is added (or filled) in the export table  
   - Depending on **Delivery** checkboxes, the extension:
     - downloads CSV/JSON  
     - copies text to the clipboard  
     - creates a **new Google spreadsheet**  
     - adds a **new blank sheet** inside the spreadsheet you scanned  
     - and/or writes a **Valid** column onto the **current** Google Sheet (opt-in)

4. **Google sign-in** (optional but required for Sheets)  
   Settings / Sign in uses Chrome’s `identity` API. Tokens are handled by Chrome; MailMiner stores only your profile (name, email, picture) locally.

---

## System design (the building blocks)

### 1. Manifest (the rules of the house)

`manifest.json` tells Chrome:

- This is a **Manifest V3** extension named MailMiner  
- Permissions: `activeTab`, `scripting`, `storage`, `identity`  
- Which websites it may call (validator, OCR, Google)  
- OAuth client ID and Sheets scopes  
- Popup UI, options page, and the background service worker  

### 2. Popup (the control panel)

**Files:** `popup/popup.html`, `popup/popup.css`, `popup/popup.js`

Owns:

- Paste box + **column map**  
- Export options (CSV / JSON / Valid+Unknown only)  
- Delivery options (download, copy, new spreadsheet, new blank sheet, update current sheet)  
- Scan / OCR / Validate buttons  
- Progress UI and a link when a new spreadsheet is created  

### 3. Background service worker (the brain)

**File:** `scripts/background.js`

Listens for messages such as:

| Message | Job |
|---------|-----|
| `OCR_REQUEST` | Send a PNG to the OCR worker (`file` multipart field) |
| `VALIDATE_EMAILS` | Call the validator API in batches |
| `AUTH_SIGN_IN` / `AUTH_SIGN_OUT` / `AUTH_STATUS` | Google account |
| `SCAN_CURRENT_SHEET` | Read the open spreadsheet via Sheets API |
| `WRITE_VALID_COLUMN` | Insert/fill a Valid column on the live sheet |
| `EXPORT_NEW_SPREADSHEET` | Create a spreadsheet with the full result table |
| `EXPORT_NEW_BLANK_SHEET` | Add a new worksheet with the result table |

### 4. Auth + Sheets services

| File | Role |
|------|------|
| `scripts/auth-service.js` | Sign in/out, get OAuth token via `chrome.identity`, refresh on 401 |
| `scripts/google-sheets-service.js` | Scan sheet, write Valid column, create spreadsheet / blank sheet |
| `options/options.*` | Settings page for Google account |

### 5. Page readers (the eyes)

| File | Role |
|------|------|
| `scripts/content.js` | Extract emails from Google Sheets DOM / HTML tables / page text |
| `scripts/sheets-bootstrap.js` | Parse Google Sheets `bootstrapData` when the grid is canvas-based |
| `scripts/ocr-scan.js` | Screenshot + crop helper for OCR |
| `scripts/ocr-parse.js` | Turn OCR text into table rows |
| `scripts/grid-bounds.js` | Find approximate grid bounds on screen |

### 6. Shared helpers

| File | Role |
|------|------|
| `scripts/csv.js` | Parse paste, find email columns, filter columns, build CSV/JSON |
| `scripts/validator.js` | Batch validate emails against the remote API |
| `scripts/config.js` | Thin loader that exports values from `config.json` |
| `scripts/config.json` | API URLs, batch rates, OAuth web client ID |

### 7. Config (without secrets)

Edit **`scripts/config.json`** only (URLs, batch size, OAuth web client ID, Google API bases).  
`scripts/config.js` re-exports those values — do not hardcode settings there.

`manifest.json` still needs matching `host_permissions` and `oauth2.client_id` / scopes (Chrome reads those at install time).

See `scripts/config.local.example.json` for a template. Copying to `config.local.json` is optional and **not** auto-merged — change `config.json` for deploy.

---

## Column map (simple rule)

In the popup, **Column map** is a comma-separated list of header names.

Example: `company_name,person_email`

- MailMiner keeps **only** those columns (plus validation info on export)  
- Names are matched loosely (spaces, case, and some aliases like `personal_email` ↔ `person_email`)  
- If you leave it blank or leave defaults that don’t match, behavior follows what headers were detected  

Use exact header names when you can.

---

## Delivery options explained

| Checkbox | What happens |
|----------|----------------|
| **Download** | Saves CSV and/or JSON files |
| **Copy** | Puts the text export on the clipboard |
| **New spreadsheet** | Creates a brand-new Google Sheet with your table (needs sign-in) |
| **New blank sheet** | Adds a new tab inside the spreadsheet you already scanned |
| **Update current sheet** | Writes a **Valid** column next to emails on the sheet you scanned (off by default; needs Editor access) |
| **Valid + Unknown only** | Drops clearly Invalid rows from downloads / new sheets (Valid column write still uses full validation) |

---

## Google Sheets flows (two modes)

### A. API mode (preferred on Sheets tabs)

1. Tab URL looks like `https://docs.google.com/spreadsheets/...`  
2. You are signed in  
3. Scan → Sheets API reads the active worksheet (`gid` in the URL)  
4. Optionally, Validate with **Update current sheet** → Writes Valid / Invalid / Unknown  

### B. Page scrape mode (fallback)

If API scan is not available, content scripts try:

1. Bootstrap data inside the page  
2. Visible grid / inner text  
3. HTML tables  
4. Generic DOM / plain-text email hunt  

OCR is a separate button for image-based tables.

---

## Folder map

```text
first-extension/
├── manifest.json          # Extension identity & permissions
├── README.md              # This guide
├── docs/
│   └── google-sheets-setup.md
├── popup/                 # Main UI
├── options/               # Google account settings
├── icons/                 # Extension icons
└── scripts/
    ├── background.js      # Message hub
    ├── auth-service.js
    ├── google-sheets-service.js
    ├── content.js
    ├── sheets-bootstrap.js
    ├── csv.js
    ├── validator.js
    ├── ocr-scan.js / ocr-parse.js / grid-bounds.js
    ├── config.js
    ├── config.json
    └── config.local.example.json
```

---

## Build / package for deploy

MailMiner is already a ready-to-load extension. There is **no compile step**.

### Package a zip for Chrome Web Store or sharing

1. Make sure `scripts/config.local.json` is **not** included if it has private URLs or keys (it is gitignored on purpose)  
2. Zip the project folder contents (include `manifest.json` at the root of the zip)  
3. Exclude junk: `node_modules`, `.git`, local notes, secrets  

Example (PowerShell, from the repo parent):

```powershell
Compress-Archive -Path .\first-extension\* -DestinationPath .\MailMiner-1.6.0.zip -Force
```

Or from inside the repo, zip the needed folders/files only.

### Before you ship checklist

- [ ] Extension loads with **Load unpacked** and popup opens  
- [ ] Validator URL reachable from your network  
- [ ] OCR worker URL reachable (if you use OCR)  
- [ ] Google Cloud: Sheets API + Drive API enabled  
- [ ] OAuth Chrome Extension client **Item ID** = your extension ID  
- [ ] Test user added if OAuth consent is still in Testing  
- [ ] Sign in → scan a Sheet → validate → optional **Update current sheet** / **New spreadsheet**  
- [ ] Version in `manifest.json` bumped (currently **1.6.0**)

Private / team deploy tip: keep the OAuth client and Cloud project under the team that will own the extension ID.

---

## Google OAuth setup (short version)

Full steps: [docs/google-sheets-setup.md](docs/google-sheets-setup.md)

You need:

1. A Google Cloud project  
2. OAuth consent screen + test users (while in Testing)  
3. **Sheets API** and **Drive API** enabled  
4. OAuth client type **Chrome Extension** with your extension’s Item ID  
5. That client ID pasted into `manifest.json` → `oauth2.client_id`

MailMiner never stores a client secret. Chrome Identity handles tokens.

---

## Troubleshooting

| Problem | Likely fix |
|---------|------------|
| Extension won’t load | `manifest.json` must be at the folder root you selected |
| Sign-in fails / bad client | Extension ID in Cloud Console ≠ loaded extension ID |
| Sheets 403 / Access denied | Enable Sheets + Drive APIs; sign out/in; check Editor rights |
| No emails found | Need an email-like column; try OCR for image sheets |
| Valid column empty | Turn on **Update current sheet**; confirm email column; re-validate |
| OCR fails | Check OCR URL in `config.json` and `host_permissions` in the manifest |
| Validate stalls | Check validator URL / network; watch status in the popup progress panel |

---

## Version

- **App version:** see `manifest.json` (`1.6.0`)  
- **Platform:** Chrome Manifest V3  

---

## License / ownership

Use and deploy under your organization rules. Do not commit API keys or private `config.local.json` content into git.
