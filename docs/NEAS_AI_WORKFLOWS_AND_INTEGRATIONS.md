# NEAS AI — Business Workflows & Integration Contracts

## 1. Priority workflow: inquiry-to-revenue
**Owner:** Sales Agent; coordinator: JARVIS; reviewers: Qualification, Finance, Engineering/Operations as required.
1. Capture inbound inquiry from website, email or approved manual entry.
2. Normalize company, contact, service interest, location, deadline and source.
3. Check duplicates and consent/communication preferences.
4. Score lead with explainable criteria: fit, scope clarity, budget evidence, timing, access to decision maker and delivery fit.
5. Ask for missing discovery details; never fabricate project requirements.
6. Route to service specialist (rope access, wind, met mast, telecom, offshore, industrial, training).
7. Qualification Agent checks mandatory client/tender criteria and evidence gaps.
8. Project Management/Engineering estimates scope assumptions and resource feasibility.
9. Finance Agent builds cost model using approved rates and records every assumption.
10. Sales Agent drafts proposal and follow-up plan.
11. Independent checks: arithmetic, scope/exclusions, compliance evidence, technical review and commercial margin.
12. Human owner/authorized approver approves proposal.
13. Only after approval may the system issue/send through an authorized integration.
14. Track sent, viewed, follow-up, negotiation, won/lost and reason.
15. Feed actual win/loss and margin outcomes into performance reporting.

**Approval gates:** client-facing price, delivery promise, contractual term, discount, purchase commitment and signed proposal.

## 2. Other business workflows
### A. Marketing campaign
Brief -> audience/sector selection -> evidence/claim validation -> keyword and content plan -> draft assets -> brand/legal review -> human approval -> schedule/publish -> analytics -> qualified-lead attribution. Paid media spend and campaign launch require approval.

### B. Customer inquiry and complaint
Receive -> classify -> detect emergency/safety/privacy/legal issue -> retrieve approved answer -> draft response -> resolve or handoff -> track SLA -> human feedback. Emergency or injury reports are immediately escalated; AI must not delay emergency response.

### C. Tender / qualification
Ingest tender pack -> extract criteria/deadlines -> build compliance matrix -> match controlled company evidence -> flag gaps/expiry -> calculate bid readiness -> draft clarification questions -> human bid/no-bid decision. No unsupported experience or credential claims.

### D. Project mobilization and delivery
Approved award -> create project record -> scope/WBS -> baseline schedule -> resource/competency check -> HSE/QA workpack drafts -> procurement readiness -> mobilization checklist -> field reporting -> progress and variance -> change control -> closeout. Human authority approves baseline, permits, risk acceptance and site release.

### E. Estimating and quotation
Scope/drawings -> quantity takeoff with assumptions -> labor/material/equipment -> productivity and duration -> overhead/contingency/insurance/bond/warranty/markup/VAT -> sensitivity analysis -> independent arithmetic review -> approval -> quotation issue. Preserve existing tested calculation logic unless a reviewed change is approved.

### F. Finance and cash visibility
Read authorized invoices, budgets, commitments, billing milestones and collections -> reconcile -> forecast cash -> flag aging/shortfall/variance -> prepare collection action drafts -> owner/finance review. No payments or bank actions.

### G. Software repair and release
Issue/alert -> reproduce -> read-only diagnosis -> branch and backup point -> minimal patch -> tests/security review -> PR -> preview deployment -> acceptance -> explicit production approval -> post-deploy verification -> rollback if required. No direct production changes from autonomous agent runs.

### H. Safety/quality review
Collect actual site data and applicable approved standards -> draft hazard/inspection checklist -> identify missing inputs -> qualified professional review -> approved release -> field evidence -> findings/corrective actions -> authorized closeout. AI never signs, certifies or authorizes safety-critical work.

## 3. Integration catalogue
| Integration | Purpose | Initial mode | Required controls |
|---|---|---|---|
| Supabase Auth/Postgres/Storage | Identity, business data, files, audit and workflows | Read + isolated development writes | RLS, private buckets, scoped server access, migration review |
| Vercel | App hosting, preview, deployment observability | Read-only / Preview first | Separate environments, protected Preview, approval for Production |
| GitHub | Issues, branches, PRs, CI and release records | Read + feature-branch writes | Branch protections, PR review, no secret access |
| Google Sheets | Reporting mirror and controlled data exchange | Read/reporting write | HMAC-signed bridge, idempotency, schema validation |
| Gmail / email | Inbound lead intake and outbound drafts | Draft/read as granted | OAuth scopes, send approval, sender allowlist |
| Calendar | Meetings, reminders and project milestones | Draft/create after permission | Calendar scope, timezone Asia/Manila, duplicate prevention |
| ElevenLabs | Voice agent / speech output | Voice output and approved agent interaction | API key server-side, consent, transcript retention policy |
| Website forms / CRM | Lead capture | Validated intake | Spam controls, consent, schema validation |
| Analytics (GA4/Rybbit) | Marketing and website performance | Read-only | Aggregation, no unnecessary PII |
| Public research sources | Market and opportunity research | Read-only | Source citations, freshness, terms compliance |

Do not connect every integration at once. Start with Supabase identity/data and CRM intake; add email drafts and reporting next. Voice and publishing are later, approval-gated phases.

## 4. Integration adapter contract
Each adapter must define:
- provider, environment and owner
- auth mechanism and requested scopes
- secret reference (never the secret value)
- supported operations with read/write classification
- input/output schemas and validation
- timeout, retry, rate-limit and idempotency behavior
- data classification and retention
- human approval rules
- health check and audit event format
- sandbox/test mode and rollback/compensation strategy

## 5. Event and workflow model
Use durable events such as:
- `lead.received`, `lead.qualified`, `proposal.draft_created`, `proposal.approved`, `proposal.sent`
- `project.created`, `project.baseline_approved`, `field_report.submitted`, `project.risk_raised`
- `approval.requested`, `approval.granted`, `approval.rejected`, `approval.expired`
- `agent.run_started`, `agent.run_completed`, `agent.run_failed`, `agent.policy_denied`
- `integration.health_degraded`, `security.alert_raised`

Every event has event_id, event_type, workspace_id, actor_id, correlation_id, occurred_at, schema_version and a minimal redacted payload. Consumers must be idempotent. Do not place credentials or raw sensitive data in event payloads.

## 6. Failure and compensation rules
- Provider timeout: retry bounded, then mark degraded and offer manual fallback.
- Validation failure: stop before write; return field-level errors.
- Permission denial: do not retry with elevated credentials; log denial.
- Duplicate delivery: deduplicate by event/idempotency key.
- Approval expiry or payload change: invalidate action and request fresh approval.
- Partial workflow failure: preserve completed steps, identify safe compensation, require approval before compensation if consequential.
- Integration outage: queue only safe/idempotent work; do not queue sensitive external sends without approval.
- Human cancellation: stop new steps and cancel cancellable operations; record any action already completed.

## 7. Sales-first rollout metrics
Executive funnel: inquiries -> qualified leads -> discovery completed -> proposal drafts -> proposals approved/sent -> won/lost -> revenue -> gross margin -> collection. Track source and service line. Do not optimize for lead volume alone; emphasize qualified pipeline, conversion, contribution margin and delivery capacity.
