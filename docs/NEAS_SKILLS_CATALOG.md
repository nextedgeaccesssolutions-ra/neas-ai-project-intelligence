# NEAS JARVIS — Complete Skills Catalogue

**Status:** Capability blueprint. These are planned skill definitions, not claims that every skill is already implemented or connected.
**Branch:** `feature/neas-jarvis-ai-brain`

## 1. Core assistant and interaction
- `chat.converse` — text conversation with context-aware answers.
- `voice.listen` — speech-to-text with explicit microphone permission.
- `voice.speak` — text-to-speech with voice, speed and language settings.
- `voice.interrupt` — stop speech and accept barge-in.
- `language.detect` — detect English, Filipino and Taglish.
- `language.translate` — translate technical and business content.
- `context.session` — maintain the current task and conversation context.
- `memory.search` — retrieve approved user/workspace memories.
- `memory.manage` — review, correct and delete retained workspace memories under policy.
- `assistant.preferences` — manage voice, language and response preferences.

## 2. Agent orchestration and skills
- `agents.route` — route a request to the appropriate specialist.
- `agents.plan` — break work into tasks, dependencies and acceptance criteria.
- `agents.delegate` — assign bounded subtasks to specialist agents.
- `agents.review` — verify outputs, calculations and citations.
- `skills.discover` — find available skills and their permissions.
- `skills.execute` — execute an authorized skill with validated inputs.
- `skills.audit` — record execution status, errors and provenance.
- `workflow.compose` — combine skills into reusable workflows.

## 3. NEAS knowledge and document intelligence
- `knowledge.search` — search approved company knowledge.
- `knowledge.ingest` — ingest approved PDFs, DOCX, XLSX, PPTX and text.
- `knowledge.extract` — extract tables, clauses, quantities and metadata.
- `knowledge.summarize` — produce cited summaries.
- `knowledge.compare` — compare revisions, specifications and scope.
- `knowledge.classify` — classify documents by project and discipline.
- `knowledge.version` — track source versions and effective dates.
- `documents.draft` — draft reports, proposals, letters and method statements.
- `documents.review` — check completeness, consistency and missing information.
- `documents.export` — export approved content to PDF, DOCX or XLSX.

## 4. Rope access, WAH, rescue and HSE
- `ropeaccess.method_statement` — draft task-specific rope access methodology.
- `ropeaccess.risk_assessment` — build hazard, risk and control registers.
- `ropeaccess.anchor_review` — check submitted anchor documentation against stated criteria; not engineering certification.
- `ropeaccess.equipment_register` — track equipment IDs, inspections and status.
- `ropeaccess.pre_use_checklist` — generate pre-use inspection checklists.
- `ropeaccess.rescue_plan` — draft rescue plans, roles, equipment and scenarios.
- `ropeaccess.team_competency` — track submitted qualifications and expiry dates.
- `hse.toolbox_talk` — prepare toolbox talks and briefings.
- `hse.permit_check` — check permit-pack completeness.
- `hse.incident_report` — structure incident and near-miss reports.
- `hse.audit_checklist` — create site inspection and compliance checklists.
- `hse.corrective_actions` — track findings, owners and close-out evidence.

## 5. Estimating, BOQ and commercial
- `estimating.quantity_takeoff` — calculate quantities from supplied drawings/data, flagging assumptions.
- `estimating.productivity` — model crew output and duration.
- `estimating.manpower` — calculate crew composition, man-hours and man-days.
- `estimating.materials` — build material takeoffs and allowances.
- `estimating.equipment` — estimate equipment, rental and consumables.
- `estimating.cost_build_up` — calculate labor, materials, equipment and logistics.
- `estimating.bonds_insurance` — model bond and insurance allowances from user-provided rates.
- `estimating.cashflow` — forecast project cash flow and billing.
- `estimating.scenario` — compare cost, margin, duration and productivity scenarios.
- `boq.generate` — generate a structured BOQ with units and quantities.
- `quotation.generate` — prepare quotation drafts with scope, exclusions and terms.
- `quotation.margin_check` — check markup, gross margin and commercial risk.
- `commercial.change_order` — draft variation and change-order records.
- `commercial.payment_schedule` — prepare milestone and progress billing schedules.

## 6. Project controls and field operations
- `project.create` — create project records from approved inputs.
- `project.status` — summarize schedule, cost, progress and blockers.
- `project.gantt` — generate and update Gantt schedules.
- `project.s_curve` — calculate planned versus actual progress curves.
- `project.resource_plan` — plan crews, shifts and equipment.
- `project.risk_register` — maintain project risks and mitigations.
- `field.daily_report` — prepare daily progress reports.
- `field.photo_log` — classify before/during/after evidence with metadata.
- `field.offline_sync` — queue and reconcile offline field updates.
- `field.timesheet` — capture and summarize approved timesheets.
- `field.material_log` — track deliveries, consumption and shortages.
- `project.closeout` — assemble punch lists, handover and closeout packs.

## 7. NEAS service-line specialists
- `wind.blade_inspection` — structure blade inspection observations and defect logs.
- `wind.blade_repair_scope` — draft repair scopes from approved inspection findings.
- `wind.turbine_access_plan` — prepare access and work-planning documentation.
- `metmast.installation_plan` — plan met mast civil, erection and commissioning activities.
- `metmast.maintenance_plan` — schedule inspection and preventive maintenance.
- `telecom.tower_workpack` — prepare tower workpacks and checklists.
- `facade.cleaning_estimate` — estimate facade/window cleaning quantities and production.
- `facade.inspection_report` — structure facade observations and recommendations.
- `facade.waterproofing_estimate` — model waterproofing areas, coats, materials and crews.
- `industrial.workpack` — prepare mechanical, electrical, welding and coating workpacks.
- `powerplant.workpack` — structure power plant maintenance workpacks.
- `training.course_pack` — draft course outlines, lesson plans and assessments.
- `training.certificate_tracker` — track training and certificate records.

## 8. Sales, marketing and business growth
- `crm.lead_capture` — structure prospect and inquiry records.
- `crm.lead_score` — score leads using configurable, explainable criteria.
- `crm.followup_plan` — draft follow-up tasks and reminders.
- `sales.proposal_builder` — prepare client-specific proposal drafts.
- `marketing.seo_audit` — review page titles, metadata, headings and content gaps.
- `marketing.content_calendar` — create channel-specific publishing calendars.
- `marketing.copywriter` — draft SEO pages, ads, captions and email campaigns.
- `marketing.social_repurpose` — adapt approved content across platforms.
- `market.research` — research target sectors, competitors and opportunities with sources.
- `business.kpi_dashboard` — summarize pipeline, revenue, margin and delivery KPIs.

## 9. Finance, HR and administration
- `finance.budget` — prepare project and operating budgets.
- `finance.variance` — compare budget, commitments and actuals.
- `finance.invoice_check` — check invoice calculations and supporting documents.
- `finance.receivables` — track due dates and collection status.
- `hr.manpower_roster` — manage project staffing plans.
- `hr.competency_matrix` — track roles, qualifications and training gaps.
- `hr.attendance_summary` — summarize submitted attendance records.
- `admin.procurement_request` — draft purchase requests and comparison sheets.
- `admin.vendor_register` — maintain supplier records and document expiry.

## 10. Integrations, automation and platform administration
- `integrations.supabase` — connect approved data operations through server-side access and RLS.
- `integrations.google_sheets` — sync authorized sheets with validation and audit trail.
- `integrations.email` — draft or process email only with granted mailbox permissions.
- `integrations.calendar` — create authorized events and reminders.
- `automation.schedule` — schedule recurring approved workflows.
- `automation.trigger` — run workflows from approved events and conditions.
- `automation.notify` — send configured status and exception notifications.
- `admin.users_roles` — administer users and least-privilege roles.
- `admin.audit_log` — inspect actions, approvals and data access.
- `admin.backup_restore` — manage verified backups and restore procedures.
- `admin.health_check` — monitor service and integration health.

## 11. Safety, security and governance
- `security.permission_check` — enforce role, project and action permissions.
- `security.secret_vault` — keep provider credentials server-side.
- `security.data_redaction` — redact sensitive fields from prompts and logs.
- `security.retention` — apply configured retention and deletion rules.
- `security.consent` — obtain and record consent for microphone and data processing.
- `safety.high_risk_review` — require qualified human review for safety-critical outputs.
- `safety.source_citations` — preserve sources, versions and assumptions.
- `safety.approval_gate` — require human approval before external or irreversible actions.

## Skill contract
Every executable skill must declare:
1. Unique ID, name, description, version and owning agent.
2. Input schema, output schema and validation rules.
3. Required permissions, data scopes and integrations.
4. Whether it is read-only, draft-only or action-capable.
5. Human approval requirements and rollback behavior.
6. Audit events, error handling, rate limits and tests.

## Initial specialist agents
- **JARVIS Orchestrator** — routes requests and coordinates agents.
- **Project Controls Agent** — schedules, progress, Gantt and S-curves.
- **Estimator & Commercial Agent** — takeoffs, BOQ, costing and quotations.
- **Rope Access & HSE Agent** — method statements, risk assessments and rescue planning.
- **Renewables & Wind Agent** — wind, blade, met mast and telecom workpacks.
- **Facade & Industrial Agent** — facade, waterproofing and industrial scopes.
- **Document & Knowledge Agent** — retrieval, comparison and document production.
- **Sales & Marketing Agent** — CRM, proposals, SEO and campaigns.
- **Finance & Admin Agent** — budgets, billing, HR and procurement.
- **IT & Integration Agent** — platform health, data integrations and automation.

## Delivery sequence
- **Phase 0 — Foundation:** inventory existing app, confirm build/runtime, define auth, data model, permissions and provider configuration.
- **Phase 1 — JARVIS core:** chat, voice, Taglish, orchestration, skill registry and audit trail.
- **Phase 2 — NEAS knowledge:** document ingestion, retrieval, citations and access controls.
- **Phase 3 — Core business workflows:** estimating, BOQ, quotation, project controls and field reports.
- **Phase 4 — Specialist skills:** rope access/HSE, renewables, facade, industrial and training.
- **Phase 5 — Business operations:** CRM, marketing, finance, HR and administration.
- **Phase 6 — Integrations and automation:** Supabase, Google Sheets, email/calendar and scheduled workflows.
- **Phase 7 — Hardening:** security review, tests, observability, backups and production acceptance.

**Non-negotiable:** safety-critical engineering, rescue, HSE and compliance outputs are decision support only. A competent, authorized person must review and approve them. No skill may invent certifications, inspection results, quantities, legal compliance or project evidence.
