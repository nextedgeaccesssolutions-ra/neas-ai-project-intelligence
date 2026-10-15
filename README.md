# NEAS AI Project Intelligence

This repository is the source-control home for the existing NEAS AI Project Intelligence Vercel deployment.

## Existing application architecture
- Static HTML, CSS, and JavaScript interface
- Vercel serverless API routes
- Supabase Auth and PostgreSQL with role-based authorization
- OpenAI-powered draft BOQ/estimate extraction with human review
- Legacy Google Sheets integration retained during transition

## Important source and deployment note
The production deployment's files were retrieved from Vercel, but the Vercel file-content endpoint truncated several large files in the response. Therefore, this repository is currently a safe project README only, not yet a complete copy of the deployed application. Do not connect this repository to a Vercel project until the full source files are imported and validated.

## Intended source layout
```
src/
  index.html
  package.json
  manifest.json
  sw.js
  NEAS_Google_Sheets_Backend.gs
  PRODUCTION_INTEGRATIONS_SETUP.md
  api/
    config.js
    extract.js
    me.js
    sync.js
    quotes/
      save.js
      approve.js
    _lib/
      auth.js
  supabase/
    migrations/
      001_neas_production.sql
```

## Required server-side environment variables
Configure these in Vercel only after the source is validated:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (server-side only)
- OPENAI_API_KEY (server-side only)
- OPENAI_MODEL (optional)

Never commit secret values. Never expose the service-role key or OpenAI API key in browser code or `NEXT_PUBLIC_*` variables.

## Database safety
Inspect `src/supabase/migrations/001_neas_production.sql` before applying it. Apply schema changes only to the confirmed Supabase project after reviewing the current schema and backups.

## Safe deployment sequence
1. Recover/export the complete source files from the original source or deployment artifacts.
2. Check the API routes, package manifest, SQL migration, and app entry point into this repo.
3. Test locally and run security checks.
4. Create a Vercel preview only after matching the repository to the deployed app.
5. Do not promote to production or assign production domains without a separate review.
