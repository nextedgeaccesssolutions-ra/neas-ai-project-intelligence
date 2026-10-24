# NEAS Live Market Price Intelligence (standalone)

A separate application directory for NEAS material-price research. It does not import the main platform, alter its database, or read/write existing project data.

## Current implementation status

- Local-first research workspace and CSV import/export are intended for the standalone app.
- Price observations must include source, observed date, location, unit, currency, VAT/delivery basis, and verification status.
- No price is treated as verified merely because it was imported. Mark `verified` only after checking a current supplier quotation, official catalog/feed, or written vendor confirmation.
- No universal public API covers all Philippine sealants, paints, and waterproofing products. Live supplier feeds require a source-specific endpoint and authorization.
- Weekly refresh target: Monday 02:00 Asia/Manila. Do not enable a hosted cron until the selected host's plan/cost and secret configuration are approved. A manual refresh/import remains available during pilot.

## Scope

Initial categories: sealants (including Greenteck and Bostik when verified SKUs are provided), interior paint, exterior paint, waterproofing materials, primers, fillers, coatings, and accessories. Keep brand/SKU, package size, unit-normalized price, coverage yield, and technical data separate; never compare prices per pail with prices per litre or per m² without a declared conversion basis.

## Credentials and setup

- `DATABASE_URL` is optional and must point only to a dedicated development database, never the NEAS production database.
- `SUPPLIER_FEED_URL` and `SUPPLIER_FEED_TOKEN` are optional and must come from a verified supplier/API provider. Do not guess URLs or scrape websites contrary to terms.
- `MARKET_REFRESH_SECRET` protects any deployed refresh endpoint.
- Never expose credentials in client-side JavaScript, Git, CSV exports, or logs.

## Verification gates

1. Confirm standalone app build and unit tests in a local/isolated environment.
2. Obtain supplier permission, feed/API documentation, sample payload, update limits, and terms.
3. Test normalization, stale-price warnings, source provenance, and duplicate handling using fixture data only.
4. Verify the preview uses separate storage and secrets. Do not connect to production.
5. Confirm hosting plan and any cron/integration costs before deployment or weekly automation.

## Data integrity

Keep each observation immutable. Corrections append a new observation with a reason and actor; never overwrite historical observations. Store retrieval time, supplier effective date, source URL/document reference, verification method, and reviewer. Display stale/unverified data distinctly. This scaffold intentionally does not contain fabricated market prices or production credentials.
