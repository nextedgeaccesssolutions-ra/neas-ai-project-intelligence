# NEAS Sheets Bridge deployment

This repository currently contains a README-only GitHub source tree; Vercel's deployed demo is a separate artifact. Do not connect this repository to the production Vercel project until the complete frontend/API source is recovered and tested.

## Deploy the Google Sheets bridge
1. Open the existing Apps Script project associated with the NEAS Google Sheet.
2. Add a script file named `NEAS_Google_Sheets_Backend.gs` and copy the code from this repository's `src/NEAS_Google_Sheets_Backend.gs`.
3. In **Project Settings → Script Properties**, set:
   - `SPREADSHEET_ID` = `19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ`
   - `API_TOKEN` = a long random secret. Keep it in Vercel server-side environment variables only; never expose it as `NEXT_PUBLIC_*`.
4. Run a function once in the editor and grant the requested spreadsheet permissions.
5. Choose **Deploy → New deployment → Web app**. Choose **Execute as: Me**. Set access to the narrowest level compatible with your calling architecture. If the Vercel server must call anonymously, use the access option permitted by your Google account policy; the endpoint still requires the API token. Deploy and copy the URL ending in `/exec`.
6. Test `/exec?action=health&token=YOUR_TOKEN` in a secure environment. Expected JSON includes `ok: true` and the spreadsheet name.
7. Store the URL and token as server-only Vercel variables such as `NEAS_SHEETS_WEBAPP_URL` and `NEAS_SHEETS_API_TOKEN`. A Vercel server API route must call the Apps Script URL; do not call it from browser code with the token.
8. Redeploy Apps Script whenever its code changes: **Deploy → Manage deployments → Edit → New version → Deploy**.

## Supported operations
- `GET ?action=health&token=...`
- `GET ?action=list&sheet=FieldReports&token=...`
- `POST` JSON with `{ "token": "...", "action": "upsert", "sheet": "FieldReports", "record": { "id": "...", ... } }`

Allowed sheet names: Projects, Activities, FieldReports, Evidence, BOQ, Quotations. This bridge is a transport adapter only; it does not replace Supabase authentication, row-level security, or server-side authorization.

## Source recovery required
The Vercel deployment includes a large `src/index.html` and other files, but the Vercel file-content API truncated the HTML payload. The GitHub default branch previously contained only README.md. Recover the exact full app and API files from a trusted source before linking GitHub to production. Do not redeploy a placeholder.
