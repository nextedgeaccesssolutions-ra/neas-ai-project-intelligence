# NEAS Shared Autonomous Repair and Release Policy

Scope: NEAS APEX, NEAS corporate website / AI Workforce, and NEAS AI Project Intelligence.

This is a repository policy specification. It becomes operational only when the required workflows, repository rules, Vercel settings, and successful test evidence are verified.

## Release lifecycle

1. Detect an issue through CI, scheduled health checks, deployment health, or an authorized work order.
2. Reproduce and classify the issue. Do not guess at root cause.
3. Create an isolated repair branch from the current default branch.
4. Make the smallest reversible change; add a regression test.
5. Run repository-native install, lint, typecheck, unit/integration tests, dependency/security audit, and production build where supported.
6. Open or update a pull request with exact evidence and risk classification.
7. Build and smoke-test a Vercel Preview deployment.
8. Merge only when GitHub's configured required checks, reviews, branch rules, and merge queue/policy all pass. Never bypass a rule.
9. Deploy production only through the configured protected production branch/release path.
10. Run production smoke tests and monitor health. Roll back to the last known-good deployment on a confirmed regression, using the normal authorized rollback path.
11. Record trigger, diagnosis, diff, test results, preview/deployment IDs, merge/deploy SHAs, rollback outcome, and cost.

## Automation permissions

- Automatically allowed when separately configured: read-only monitoring, diagnostics, issue creation, isolated repair branches, low-risk code fixes, tests, commits to repair branches, PR creation, preview deployments, and bounded retries.
- Conditional: auto-merge and production deployment only after the repository's normal required checks/reviews/rules are satisfied and Vercel production branch/domain mapping is verified.
- Never bypass: branch protection, required checks, security scans, review requirements, deployment protection, or authentication.
- Never autonomously alter secrets, OAuth grants, identity/role permissions, production database data, billing limits, DNS, destructive schema migrations, customer communications, financial commitments, or HSE/engineering approvals.
- Gmail and social-platform credentials, mailbox scopes, outbound sending and publishing permissions are governed separately from software deployment.

## Failure handling

- Maximum two automatic retries for transient CI/infrastructure failures; no retry loop for deterministic test/security failures.
- Stop and open an issue when a repair is ambiguous, security-sensitive, destructive, changes auth/permissions, lacks a regression test, or fails twice.
- Never auto-merge a stale, conflicting, non-mergeable, draft, or failing PR.
- Never report a workflow as enabled until its schedule/trigger is installed and at least one successful run is observed.
- Never report a production release as complete until the production deployment and post-deploy health checks are verified.

## Required repository configuration audit

Verify and record:
- Default branch and branch protection/rulesets.
- Required status checks and review requirements.
- Whether auto-merge is enabled at repository level.
- GitHub Actions permissions, workflow triggers, concurrency, secrets exposure and fork-PR safety.
- Vercel project ID, linked Git repository, production branch, domains, deployment protection, environment scopes and rollback target.
- Build/test/security checks and post-deploy smoke tests.

## Completion states

Use distinct states: NOT_STARTED, CONFIGURED, ENABLED, TESTED, VERIFIED, BLOCKED. A plan or document is not proof of an active automation.
