# NEAS AI — Test Strategy, Acceptance Criteria & Implementation Roadmap

## 1. Test pyramid
### Unit tests
- Agent config schema validation and version compatibility.
- Intent/risk classification with deterministic fixtures.
- Tool input/output schema validation.
- Permission policy evaluation and approval binding.
- Cost, token and usage attribution.
- Workflow state transitions, retries, timeout and idempotency.
- Redaction and citation formatting.
- Existing project-control calculations remain regression-tested.

### Integration tests
- Supabase Auth and RLS by role, workspace and project membership.
- Agent run persistence, event ledger and usage ledger.
- Workflow runner with mocked model/provider and integration adapters.
- Approval request/decision and exact payload hash validation.
- Google Sheets bridge signature, replay prevention and mapping.
- Email/calendar sandbox operations.
- Private Storage signed URL and document access controls.

### End-to-end tests
- New inquiry -> qualified lead -> proposal draft -> approval -> send simulation.
- Tender upload -> compliance matrix -> evidence gap report.
- Project record -> schedule -> field report -> progress dashboard.
- Customer complaint -> escalation -> human resolution.
- Agent failure -> retry -> dead-letter/manual review.
- Revoked user session cannot read, write or continue queued actions.
- Mobile command center and voice consent/stop controls.

### Security and abuse tests
- Cross-workspace and cross-project IDOR/BOLA.
- Anonymous access and missing authentication.
- Prompt injection in uploaded documents, emails and retrieved web pages.
- Tool schema bypass, privilege escalation and agent self-approval.
- Secret leakage in client bundle, logs and error responses.
- SSRF, malicious URLs, oversized files and unsafe file types.
- Rate-limit bypass, replay, duplicate execution and workflow recursion.
- RLS behavior for SELECT/INSERT/UPDATE/DELETE and views.
- Audit log tampering and retention/deletion policy.

## 2. Required acceptance gates
A release cannot proceed unless:
1. All critical and high-severity security tests pass.
2. RLS tests prove non-members cannot access another workspace/project.
3. No provider secret appears in browser assets, source maps, logs or API responses.
4. No R3/R4 action can execute without the required human approval.
5. Approval binds to the exact action payload and expires safely.
6. Retries do not create duplicate CRM records, messages, payments or workflow actions.
7. Every agent run has provenance, version, actor, model, tool and outcome records.
8. Knowledge responses show source citations or clearly state no source was found.
9. Human reviewers can pause an agent, cancel a workflow and reject an action.
10. Existing project-control unit/database tests continue to pass.
11. Preview deployment and rollback are verified before production approval.
12. Cost limits, alerting and global/agent-level kill switches are tested.

## 3. Agent evaluation scorecard
Score each agent on a reviewed test set:
- task success / completeness
- factual accuracy and source coverage
- policy adherence and permission correctness
- output schema validity
- human correction/rework rate
- latency and cost per accepted outcome
- escalation precision and recall
- robustness to ambiguity and prompt injection

Initial release thresholds (proposed, calibrate with real NEAS cases):
- 100% pass on critical permission and approval tests.
- 100% pass on critical safety/prohibited-action tests.
- >= 95% structured output validity.
- >= 90% human acceptance for low-risk routine drafts in the pilot set.
- 0 unapproved external actions.
- 0 unresolved critical/high security findings.
These are proposed acceptance targets, not current measured results.

## 4. Phased implementation plan
### Phase 0 — Repository and environment baseline
- Audit branch, build configuration, existing Supabase migrations, RLS, project-control modules and JARVIS MVP.
- Confirm Preview build topology; existing JARVIS setup notes a possible app/pages root mismatch requiring resolution.
- Confirm Supabase project and environment ownership without exposing credentials.
- Create backup/tag and isolated development/preview environment.
**Exit:** source audit, baseline tests, environment inventory and no production changes.

### Phase 1 — Business foundation (first priority)
Build first: JARVIS Orchestrator foundation, Sales/CRM, Qualification/Tender, Finance/Commercial, Marketing, Content, Customer Service and Performance.
- Define agent and skill registries.
- Implement authenticated task intake and request classification.
- Add lead intake, qualification and CRM draft workflow.
- Add proposal assembly using existing quotation/costing logic.
- Add human approval inbox and audit trail.
- Add KPI dashboard for lead-to-proposal funnel.
**Exit:** inquiry-to-proposal workflow passes end-to-end with approval; no autonomous sending or price commitment.

### Phase 2 — Core platform and data
- Additive `neas_ai` schema, RLS and migration tests.
- Durable workflow/run/step/event storage.
- Knowledge ingestion and source citations.
- Usage ledger, budget limits and observability.
- Workspace and project-level permissions.
**Exit:** RLS matrix, replay/idempotency, backup and restore pass.

### Phase 3 — Delivery and technical agents
- Project Management, Rope Access Engineering, Renewable, Offshore/Industrial, HSE, QA/QC, Training, Document Control and Procurement.
- Connect existing BOQ, Gantt, S-curve, field reports, project register and site evidence.
- Add mandatory qualified-person approval gates.
**Exit:** representative project workpack and progress workflow accepted by domain reviewers.

### Phase 4 — Engineering, DevOps and intelligence
- Software Engineering, DevOps/Security, Data Intelligence, AI Research and Internal Audit.
- Branch-only code repair, PR checks, preview validation and security audit workflows.
- Model benchmark/evaluation harness.
**Exit:** isolated repair PR passes CI and human review; no direct production mutation.

### Phase 5 — Voice, external channels and controlled automation
- ElevenLabs voice interface and consent.
- Email/calendar integrations, content scheduling and approved notifications.
- Scheduled workflows with explicit scope, pause and audit.
**Exit:** integration scope, consent, approval and revocation tests pass.

### Phase 6 — Production readiness
- Load, resilience, disaster recovery, access review, incident response and cost-control drills.
- Owner training and agent operator handbook.
- Preview acceptance, deployment approval and post-release monitoring.
**Exit:** signed production readiness checklist and owner approval.

## 5. Proposed 90-day sequence
| Period | Outcome |
|---|---|
| Days 1-10 | Source audit, build baseline, agent contracts, security model |
| Days 11-25 | Sales-first orchestration, CRM intake, lead qualification, proposal drafts |
| Days 26-40 | Approval inbox, audit ledger, finance checks and sales dashboard |
| Days 41-55 | Supabase AI schema, RLS, workflow durability and knowledge retrieval |
| Days 56-70 | Project delivery and technical agent pilots |
| Days 71-80 | DevOps, data intelligence, evaluation and security hardening |
| Days 81-90 | Voice/integrations, UAT, training and production readiness review |

The timeline is a planning estimate. It depends on repository health, available credentials, Supabase environment, integration approvals and test evidence.

## 6. Definition of done for every agent
- Reviewed agent specification and owner.
- Versioned prompt/config and skills.
- Explicit data/tool permissions.
- Input/output schemas with validation.
- Unit, integration, security and evaluation tests.
- Human approval and escalation behavior.
- Audit and usage telemetry.
- Runbook, kill switch and rollback behavior.
- Human acceptance on representative NEAS scenarios.
- Deployment state accurately labeled: planned, development, preview, production.

## 7. Operational runbooks required
- Provider outage/model fallback.
- Suspected prompt injection or data exposure.
- Compromised integration credential.
- Incorrect proposal/cost calculation.
- Workflow stuck/retry storm.
- Unauthorized action attempt.
- RLS regression/data access incident.
- Backup restore and disaster recovery.
- Agent pause/disable and safe re-enable.
