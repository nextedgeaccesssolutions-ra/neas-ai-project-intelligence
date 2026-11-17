# NEAS AI Multi-Agent Operating System
**Status:** Architecture baseline / implementation specification  
**Target branch:** `feature/neas-multi-agent-operating-system`  
**Operating model:** Hybrid autonomy with human approval gates  
**Business priority:** Sales, pipeline, customer experience and profitable delivery  
**Brand:** NEAS navy `#071D29`, gold `#CA9332`, sand gold `#EBC07E`

## 1. Executive design decision
NEAS AI is one governed business operating system, not 24 independent chatbots. JARVIS is the orchestrator. Specialist agents are bounded workers with declared skills, data scopes, tool permissions, model policy, acceptance criteria and measurable KPIs. Every consequential action is represented as a workflow step and recorded in an audit trail.

Build on the existing `neas-ai-project-intelligence` repository and preserve its project-control modules: estimating/BOQ, quotation, project management, Gantt/S-curve, field reports, project register, site evidence and Google Sheets reporting. The existing `feature/neas-jarvis-ai-brain` branch contains an early JARVIS chat endpoint and static agent/skill registry. Its current chat routing is a lightweight specialist label selector, not a verified multi-agent execution engine. The new branch extends the documented design without replacing the existing project-control system.

## 2. Target architecture
```text
Human owner / authorized staff
        |
NEAS Command Center (Next.js UI, text + voice, English/Filipino/Taglish)
        |
API Gateway: authentication, tenant/project scope, rate limit, request validation
        |
JARVIS Orchestrator
  |-- intent + risk classifier
  |-- planner / dependency graph
  |-- agent registry + skill registry
  |-- policy / permission engine
  |-- model router
  |-- workflow runner + approval queue
  |-- evaluator / independent reviewer
  |-- audit + cost + telemetry
        |
24 specialist agents (bounded, versioned configurations)
        |
Skill execution layer (typed inputs, allowlisted tools, output schemas)
        |
Domain services: CRM, sales, marketing, project controls, estimating, finance,
engineering, HSE, QA/QC, training, procurement, documents
        |
Supabase Postgres + private Storage + pgvector / approved knowledge sources
        |
Integrations: Google Workspace, email, calendar, Sheets, Vercel, GitHub,
ElevenLabs, analytics and approved third-party services
```

### Runtime boundaries
- **UI:** Next.js App Router, responsive command center, agent directory, workflow timeline, approval inbox, usage dashboard and voice controls.
- **API:** authenticated server-side route handlers; never call privileged integrations directly from the browser.
- **Orchestration:** deterministic policy checks first, LLM planning second, validated skill execution third, independent review and approval last.
- **Workers:** long-running jobs execute asynchronously with durable state, retry policy, idempotency keys and cancellation.
- **Data:** Supabase Postgres is the cloud system of record when cloud mode is configured; local/offline project-control behavior remains available as currently designed.
- **Knowledge:** versioned documents, metadata, embeddings and citations. Retrieved documents are untrusted data, never executable instructions.
- **Observability:** structured traces across request, plan, agent run, skill call, approval, integration and final result.

## 3. Core services
| Service | Responsibility |
|---|---|
| JARVIS Orchestrator | Plans tasks, routes agents, tracks dependencies and assembles result |
| Agent Registry | Versioned agent identity, mission, skills, allowed tools and policies |
| Skill Registry | Typed executable capability contracts and permissions |
| Policy Engine | Enforces role, project scope, risk class and approval requirements |
| Model Router | Selects model by task class, quality, latency, privacy and cost |
| Workflow Engine | Durable multi-step execution, retries, timeouts and compensation |
| Approval Service | Human review, approve/reject/request changes and expiry |
| Knowledge Service | Retrieval with source/version/permission filtering and citations |
| Evaluation Service | Schema, factuality, calculation, policy and reviewer checks |
| Audit Service | Append-only record of actions, inputs, outputs, approvals and provenance |
| Integration Gateway | Server-side adapters with scoped credentials and rate limits |

## 4. Agent execution contract
Every agent run must carry:
- `run_id`, `task_id`, `agent_id`, `agent_version`, `workflow_id`
- authenticated actor, workspace and optional project scope
- user objective, allowed data sources and allowed tools
- risk level, autonomy mode and required approval
- model/provider identifier and prompt/config version
- structured input, structured output and source citations
- status, start/end time, token/cost metadata and error information

Agent outputs are proposals until validated. Agents cannot expand their own permissions, change their role, approve their own output or bypass the policy engine.

## 5. Autonomy and risk policy
| Class | Examples | Permitted behavior |
|---|---|---|
| R0 Read-only | Search company knowledge, summarize pipeline, inspect project status | May run autonomously within authorized data scope |
| R1 Draft | Draft emails, proposals, BOQ, reports, marketing content | May create drafts; external send/issue requires approval |
| R2 Reversible internal write | Create internal CRM task, update draft record, create reminder | Allowed only with scoped permission, idempotency and audit |
| R3 Consequential action | Send external email, issue quotation, publish content, commit purchase request, deploy production | Human approval required |
| R4 Critical / prohibited autonomous | Payment, contract signature, bank transfer, employment decision, safety authorization, engineering certification, permit approval | Human/qualified authority only; AI may prepare evidence but cannot authorize |

No agent may autonomously authorize site work, certify an anchor/design, approve a rescue plan for execution, sign a contract, transfer funds, purchase goods, or declare a person competent.

## 6. Model strategy
Use a provider-neutral model adapter. Route by capability rather than hard-coded model names:
- fast/low-cost model: classification, extraction, routine drafting
- advanced reasoning model: strategy, complex proposal analysis and multi-step planning
- coding model: code review and software changes in isolated branches
- vision model: image/document interpretation, with human inspection for safety-critical evidence
- speech model: transcription and voice output
- embedding/reranking models: knowledge retrieval

Model identifiers and provider capabilities must be loaded from a maintained configuration and checked against the selected provider at deployment time. No model ID is assumed permanent. Use Vercel AI Gateway or an equivalent controlled gateway where configured; never expose provider credentials to clients. Track provider, model, tokens, latency, cost and evaluation outcome.

## 7. Human command center
Required screens:
1. Executive dashboard: revenue pipeline, proposals, win/loss, margin, projects at risk, agent health and spend.
2. JARVIS conversation: task intake, context, plan preview, status and result.
3. Agent directory: mission, owner, skills, permissions, model policy, version and health.
4. Workflow center: run graph, retries, failed steps, cancellation and replay.
5. Approval inbox: action summary, source evidence, risks, diff, approve/reject/request changes.
6. Knowledge center: source documents, versions, access scopes and ingestion status.
7. Performance center: quality, completion, latency, escalation, cost and human rework.
8. Governance center: role assignments, policies, audit, retention and integration health.

Visual direction: preserve NEAS navy/gold identity. English/Filipino/Taglish input is supported; formal external outputs default to professional English unless user requests another language.

## 8. Non-functional requirements
- Tenant/project isolation enforced server-side and in database policies.
- All write operations have actor, idempotency key and audit record.
- Workflow steps are retry-safe and observable.
- Every external action has preview and approval where required.
- Knowledge answers include citations and document versions.
- Agent configs and prompts are version-controlled.
- Graceful degradation when a provider or integration is unavailable.
- Offline project-control features remain separate from live AI execution; live AI requires authenticated connectivity.
- Accessibility, mobile responsiveness and timezone `Asia/Manila`.

## 9. Current-state findings and constraints
Verified repository facts:
- Public repository: `nextedgeaccesssolutions-ra/neas-ai-project-intelligence`.
- Default branch is `main`; existing development branch is `feature/neas-jarvis-ai-brain`.
- README documents project control modules and device/cloud modes.
- JARVIS MVP documentation describes `api/jarvis/chat.js`, `public/jarvis/index.html` and `public/jarvis/registry.json`.
- The existing JARVIS endpoint is general chat with lightweight agent label selection; it does not yet query Supabase, CRM, project data or execute business actions.
- The existing skill catalogue explicitly labels its entries as capability blueprint, not proof every skill is implemented.
- The existing MVP setup notes a deployment structure/build concern that must be reconciled before claiming a successful Preview deployment.

Do not claim the 24 agents are deployed or operational until code, credentials, database policies, integration tests and acceptance checks pass. This branch is documentation-first. Production, existing Vercel routing, DNS and live Supabase data are not changed by this architecture commit.

## 10. Delivery definition
A production-ready release requires: authenticated user identity; enforceable project scope; agent and skill registry; durable workflows; policy enforcement; approval inbox; audited integrations; RLS tests; model/provider checks; monitoring; backup/restore; and signed-off acceptance tests. See the companion agent catalogue, database/security, workflow/integration and test/roadmap documents.
