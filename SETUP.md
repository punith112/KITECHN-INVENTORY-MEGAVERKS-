# Megaverks Canteen v1.0.0

A mobile-first canteen stock register with a static GitHub Pages frontend and a private Google Apps Script + Google Sheets backend.

## 1. Create the Google Sheet and Apps Script backend

1. Sign in to the Google account that will own the canteen records.
2. Create a blank Google Sheet named **Megaverks Canteen Database**. Keep it private; staff use the app, not the Sheet.
3. In Google Drive, create a folder named **Canteen Bill Photos**. Copy its folder ID from the URL.
4. Open **Extensions → Apps Script** in the Sheet.
5. Create two script files:
   - `Code.gs`: paste the contents of `backend/Code.gs`.
   - `Seed.gs`: paste the contents of `backend/Seed.gs`.
   - Alternatively, replace `Code.gs` with the combined `backend/Canteen-Apps-Script.txt`.
6. In **Project Settings → Script Properties**, add:
   - `SHEET_ID`: the spreadsheet ID from its URL (not needed for a Sheet-bound script, but recommended).
   - `DRIVE_FOLDER_ID`: the bill-photo folder ID.
   - `INSTITUTION_NAME`: your school / college canteen name.
   - `GEMINI_API_KEY`: your private Gemini API key.
   - `GEMINI_MODEL`: a current vision-capable Flash model. The code defaults to `gemini-2.5-flash`; confirm availability in your Google AI Studio account and update this property without editing code.
   - `ADMIN_USERNAME`: your first admin username.
   - `ADMIN_PASSWORD`: a temporary password of at least 10 characters.
7. Save, choose the `setupCanteen` function and click **Run**. Approve Sheets, Drive and external-request permissions. The function creates every tab, loads the item/dish/staff masters, creates the admin and removes the temporary password property.
8. In the Sheet, verify these tabs: Items, Inward, Issue, Plates, Dishes, Adjust, Staff, Users, Log. Do not rename their headers.
9. Click **Deploy → New deployment → Web app**:
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Deploy and copy the web-app URL ending in `/exec`.
10. Open that `/exec` URL in a browser with `?action=ping` appended. It should return a JSON response with `"ok":true`.

> Editing Apps Script code does not update an existing deployment. For later changes, use **Deploy → Manage deployments → Edit → Version: New version → Deploy** on the same deployment. Do not accidentally create a second `/exec` URL.

## 2. Launch on GitHub Pages

1. Create a GitHub repository, for example `megaverks-canteen`.
2. Upload all frontend files to the repository root: `index.html`, `app.js`, `styles.css`, `config.js`, `seed-data.js`, `demo-api.js`, `manifest.webmanifest`, `sw.js`, `404.html`, `assets/`, and `vendor/`. The included `.github/workflows/pages.yml` can deploy automatically from `main`.
3. Open **Settings → Pages → Build and deployment**. Select **GitHub Actions** when using the included workflow, or **Deploy from a branch → main / root** for manual static hosting.
4. Open the GitHub Pages URL. On the sign-in screen choose **Connect Google Sheets**, paste only the Apps Script `/exec` URL and save.
5. Sign in with the admin created during setup. Open Settings → Users to add Storekeeper and Viewer accounts.
6. To make the connection default for every device, put only the public `/exec` URL in `config.js` and commit it. Users can also save it on their own device; no secret is stored there.

The login cannot be done by GitHub or the frontend alone. Password hashes, session checks and role checks all run inside Apps Script.

## 3. First-day use

1. Admin: check item names, local names, units, conversions and minimum levels in **Settings → Item master**.
2. Add kitchen staff under **Settings → Staff & dishes**.
3. Enter opening balances with **Add Stock → Physical count**. Blank items are ignored; enter zero for empty shelves.
4. Storekeeper: use **Today** for each meal. Plates are required when items have been issued. Evening Snacks may remain empty.
5. Photograph bills only in good light. Always review extracted values. AI output never posts directly to stock.

## 4. Data and security boundaries

- The frontend contains no Gemini key, Sheet ID or real password. Do not add them to `config.js` or GitHub.
- Apps Script sessions are cached for up to six hours. Five failed sign-ins lock the account for 15 minutes.
- Apps Script “Anyone” access permits the public page to call the endpoint; the app’s own login and role checks protect every data action.
- This is appropriate for a small canteen register, not bank-grade identity. Move to managed identity if stronger assurance is required.
- Stock is calculated as opening + inward + adjustments − issues. Corrections add reversing entries; original rows are never deleted.
- Offline entries are queued only in the current browser. Sync before clearing browser data. Photo scanning requires internet.
- Optional item-reference photos and original bill scans stay in the owner’s private Drive folder. Item thumbnails are retrieved only through an authenticated Apps Script request.
- Estimated values and cost per plate use the latest purchase rate and are operational estimates, not financial statements.

## 5. Test scope

The included local demo is for training and interface testing only. It stores sample data in the browser and returns explicitly labelled sample scan results; it makes no AI, Drive or Sheets calls. The production Apps Script deployment and Gemini quota must be smoke-tested from the owner’s Google account after setup.

### v1.0.0 verification

- 44 Apps Script regression assertions passed with mocked Google services.
- 36 desktop/mobile browser assertions passed, with no console errors or missing assets.
- 48 final acceptance assertions passed: inventory-photo confirmation, unmatched bill items, private reference-photo flow, Admin negative-stock warning, reversing entries, dishes/users, CSV/print, connection validation, real `text/plain` browser POSTs, and 375/430/768/1024/1440 px layouts.
- Static checks cover viewport/zoom, dead controls, placeholder links, JavaScript syntax, combined backend consistency, and accidental secrets in public runtime files.

### v1.0.0 feature build

Includes Megaverks Technologies branding, Admin/Storekeeper/Viewer access, four-meal plates and direct stock issue, favourites/search/steppers/repeat-yesterday, bill and inventory-photo review, manual purchases and physical counts, permanent ledger reversals, low-stock reports, CSV/print, offline outbox, installable app shell, admin masters/users/backup, and private reference photos.

**Not live-tested here:** the owner’s Google Sheet, Drive, Apps Script deployment and Gemini account. GitHub Pages and Apps Script deployment require the owner’s logins.
