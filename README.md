# NEAS AI Project Intelligence

Source repository for the existing NEAS AI Project Intelligence Vercel deployment.

## Architecture
- Static HTML/CSS/JavaScript application in `src/index.html`
- Vercel serverless API routes in `src/api/`
- Supabase Auth, Postgres, and role-based authorization
- Legacy Google Sheets integration retained during migration
- OpenAI-powered construction BOQ/estimate extraction with human review

## Source layout
```
src/
  index.html
  manifest.json
  sw.js
  package.json
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

## Local preparation
Use Node.js 24.x. Install dependencies from the `src/` directory:

```bash
cd src
npm install
```

The Vercel deployment uses `src/` as the deployment root. Keep this root directory configuration when a Vercel project is linked later.

## Environment variables
Configure these in a trusted deployment environment, never commit them:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `OPENAI_API_KEY` (server-side only)
- `OPENAI_MODEL` (optional)

Do not expose privileged secrets with `NEXT_PUBLIC_` prefixes or in browser code.

## Database
Review `src/supabase/migrations/001_neas_production.sql` and apply it only to the intended Supabase project after verifying the target database and existing schema. Do not run a production migration simply by cloning this repository.

## Deployment safety
This repository is intended to mirror the application files from the existing Vercel deployment. It is not connected to Vercel yet. Confirm a preview deployment works before linking or promoting any production deployment. Do not overwrite existing production projects or attach production domains without explicit review.
