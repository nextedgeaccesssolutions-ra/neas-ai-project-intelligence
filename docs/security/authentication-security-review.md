# Authentication Security Review

## Scope

This review covers username/PIN sign-in, password recovery, account activation, PIN re-checks for privileged actions, and the dependency audit used by PR #36.

## Controls verified in source

- Six-digit PINs are validated server-side. The raw PIN is not stored as a Supabase Auth password; `lib/cloud/pin.ts` derives an account-bound HMAC credential using a server-only pepper.
- PIN login calls server-only database functions. The functions are not executable by `anon` or `authenticated` roles.
- Failed PIN attempts are recorded by username and keyed IP hash. The database enforces per-network and per-account cooldowns and records lockout events.
- Password-to-PIN recovery requires a valid Supabase recovery session and an active, e-mail-verified NEAS profile.
- Sensitive account and access changes require a recent server-verified credential re-check. The database window expires after 10 minutes.
- Same-origin checks and bounded JSON body parsing are applied to authentication mutation routes.
- Public login errors avoid disclosing whether a username exists or whether it belongs to a staff or client account.

## Repeatable validation

Run these from the repository root:

```bash
npm ci
npm test
npx tsc --noEmit
npm audit --audit-level=high
npm run build
```

The unit suite includes `tests/pin.test.ts` for PIN and username rules and `tests/auth-security.test.ts` for account-bound, non-plaintext PIN credential derivation. Database authorization and lockout regression cases are in `supabase/tests/98_pin_login.sql` and run through the repository's database test harness when a configured local Supabase/PostgreSQL test environment is available.

The GitHub Actions workflow runs the unit tests, TypeScript check, high-severity dependency audit, and production build on pull requests to `main`.

## Operational notes

- Configure `PIN_PEPPER` as a long random secret in the deployment environment before issuing PINs. If omitted, the server derives the pepper from the Supabase service-role key; rotating that key then invalidates existing PINs.
- Never log, commit, e-mail, or expose raw PINs or the service-role key.
- A green build or dependency audit is not a substitute for running the database authorization suite against the target Supabase schema before production rollout.
