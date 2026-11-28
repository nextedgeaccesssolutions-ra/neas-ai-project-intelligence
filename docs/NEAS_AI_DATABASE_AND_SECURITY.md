# NEAS AI — Database Design, Permissions & Security
**Design target:** Supabase Postgres + private Storage, integrated with existing project-control schema without replacing it.

## 1. Database principles
1. Keep existing project-control tables and business records intact. Add AI data in a dedicated schema such as `neas_ai` (confirm current migrations and Supabase project before applying).
2. Use UUID primary keys, UTC timestamps, explicit workspace/project scope, foreign keys and check constraints.
3. Every user-facing query is authenticated and scoped. RLS is enabled on every exposed table.
4. Agent runs and audit events are append-oriented; corrections create new events or versions.
5. Store secrets only in server-side environment/secret storage, never in database rows readable by normal users or client bundles.
6. Use relational metadata plus vector retrieval; vector similarity never bypasses authorization.
7. Keep raw prompts/responses only when necessary and apply redaction and retention policies.

## 2. Proposed logical entities
| Table | Purpose | Important fields |
|---|---|---|
| `workspaces` | Business tenant boundary | id, name, status |
| `workspace_members` | User-to-workspace membership | workspace_id, user_id, role, status |
| `agent_definitions` | Versioned agent config | agent_key, version, mission, config_json, status |
| `agent_skills` | Agent-to-skill grants | agent_id, skill_id, enabled |
| `skill_definitions` | Typed capability catalogue | skill_key, version, input_schema, output_schema, risk_class |
| `agent_runs` | One agent execution | workflow_id, agent_id, actor_id, project_id, status, model, cost |
| `agent_run_events` | Step/event trace | run_id, event_type, payload_redacted, occurred_at |
| `workflow_definitions` | Versioned workflow graphs | workflow_key, version, definition_json |
| `workflow_runs` | Durable workflow instance | status, initiator_id, idempotency_key |
| `workflow_steps` | Durable step state | run_id, step_key, attempt, status, input_ref, output_ref |
| `approval_requests` | Human approval queue | action_type, risk_class, requested_by, status, expires_at |
| `approval_decisions` | Immutable decision history | approval_id, decided_by, decision, reason |
| `integration_connections` | Non-secret integration metadata | provider, scopes, status, secret_ref |
| `knowledge_sources` | Source document registry | source_uri, version, classification, project_id |
| `knowledge_chunks` | Searchable document segments | source_id, chunk_no, content, embedding, metadata |
| `agent_evaluations` | Quality and safety evaluations | run_id, evaluator, scorecard, result |
| `agent_feedback` | Human feedback | run_id, actor_id, rating, tags, comment_redacted |
| `usage_ledger` | Model and integration usage | run_id, provider, model, tokens, cost, currency |
| `audit_events` | Security/business audit trail | actor, action, target, decision, correlation_id |
| `policy_versions` | Versioned authority policies | policy_key, version, policy_json, active |

Existing project tables remain the authoritative source for project, BOQ, quotation, schedule and field data. AI records reference existing project IDs; they do not copy commercial or safety source records unless an explicit snapshot is needed for traceability.

## 3. Suggested relationships
```text
workspace 1--N members
workspace 1--N agents / skills / workflows / knowledge sources
agent 1--N agent_runs
agent N--N skills (agent_skills)
workflow 1--N workflow_runs
workflow_run 1--N workflow_steps
workflow_run 1--N agent_runs
agent_run 1--N run_events / evaluations / feedback / usage
approval_request 1--N approval_decisions
knowledge_source 1--N knowledge_chunks
project 1--N scoped agent_runs / knowledge_sources / workflow_runs
```

## 4. Key constraints and indexes
- Unique `(workspace_id, agent_key, version)`, `(workspace_id, skill_key, version)`, `(workspace_id, workflow_key, version)`.
- Unique idempotency key per actor/workspace and action class.
- Index `(workspace_id, status, created_at desc)` on workflows/runs.
- Index `(project_id, created_at desc)` on project-scoped records.
- Index pending approvals by `(workspace_id, status, expires_at)`.
- Vector index on embedding with metadata filters; filter by workspace, project, classification and membership before ranking.
- Foreign keys prevent orphaned runs and approval records; soft-delete only where retention policy allows.

## 5. Role model
| Role | Scope |
|---|---|
| Owner / Super Admin | Workspace-wide configuration, role grants, approvals and audit access |
| Executive | Business dashboards and approved commercial summaries |
| Sales / Marketing | CRM and approved marketing data; no private finance or engineering records by default |
| Project Manager | Assigned projects, schedules, reports and approved commercial view |
| Finance | Authorized costing, budgets, billing and cash-flow records |
| Engineer / HSE / QA | Assigned technical project records within discipline |
| Employee / Technician | Assigned workpack, own submissions and permitted project data |
| Client | Explicitly shared client-facing project snapshot only |
| AI service principal | Only service operations delegated by the authenticated actor and policy engine |

Agent identity is not a human user role. An agent run executes with a constrained service identity plus the initiating user's effective permissions; it must never inherit unrestricted service-role access for ordinary actions.

## 6. RLS and authorization rules
- Enable RLS on every table in exposed schemas. Prefer a private schema for internal AI tables and expose only narrowly scoped RPCs/views.
- Use explicit workspace membership and project membership predicates. `TO authenticated` alone is not authorization.
- Authorization attributes belong in trusted app metadata or database membership tables, never user-editable user metadata.
- Update policies require both `USING` and `WITH CHECK`.
- Views exposed to users should use `security_invoker = true` on supported Postgres versions, or be placed in a private schema with grants revoked.
- Avoid SECURITY DEFINER for routine operations. If a privileged function is unavoidable, isolate it in a non-exposed schema, verify actor and role inside the function, minimize grants and audit every call.
- Never return service-role keys or secret values. Server-side code uses privileged credentials only for narrowly scoped administrative tasks after explicit authorization.
- Client portal access is via an allowlisted server-built snapshot, never direct broad table access.

## 7. Security controls
### Identity and sessions
- Supabase Auth with verified email and administrator-approved membership where required.
- MFA for owner/admin and privileged staff.
- Short-lived sessions for sensitive operations; revoke sessions when access is removed.
- Validate current membership for high-risk actions rather than relying only on stale JWT claims.

### Prompt and tool security
- Treat user input, retrieved documents, web pages, emails and tool output as untrusted.
- Separate system policy from retrieved content; retrieved content cannot issue instructions.
- Tools use strict JSON schemas, allowlists, parameter validation and server-side authorization on every call.
- No arbitrary shell, SQL, URL fetch, filesystem or browser tool for general agents.
- Prevent SSRF with host allowlists, DNS/IP validation and blocked private/link-local ranges for any URL ingestion.
- Apply output encoding and safe rendering; never execute model-generated code.

### Data protection
- Classify data: Public, Internal, Confidential, Restricted.
- Minimize PII and redact personal/financial/security data from model prompts and logs unless strictly needed.
- Encrypt in transit and at rest through platform controls; use private buckets and signed URLs with short expiry.
- Define retention and deletion for conversations, run traces, documents and embeddings.
- Never store passwords, API keys, refresh tokens or full payment details in prompts or audit payloads.

### Abuse and resilience
- Per-user, per-workspace and per-IP rate limits; provider budget ceilings and alerting.
- Request-size, token, recursion and tool-call limits.
- Idempotency keys for writes; exponential backoff with jitter for transient errors.
- Circuit breakers and provider failover only to pre-approved models.
- Kill switch per agent, skill, integration and global AI execution.
- Immutable or append-only audit with export/backup and periodic restore tests.

## 8. Approval policy
An approval request must show: action, target, before/after diff, business reason, sources, amount/recipient if relevant, risk class, agent/run identity, expiry and rollback/compensation plan. Approval is bound to the exact payload hash; any payload change invalidates approval. The requester cannot approve their own high-risk action where separation of duties is required.

## 9. Migration plan (design only)
1. Inspect current Supabase project, migration history, extensions, existing schema and RLS before writing migration SQL.
2. Create a dedicated schema and additive migrations only; do not rename/drop existing project-control tables.
3. Create tables and indexes; enable RLS before granting access.
4. Add policies and service functions; test as anon, authenticated, owner, project member, non-member and client.
5. Add private Storage bucket/policies only if knowledge file storage is approved.
6. Run Supabase security advisors and database integration tests.
7. Apply to isolated development/preview database first; production requires separate explicit approval and backup verification.

This document is a schema design, not evidence that these tables have been created or that any Supabase project has been modified.
