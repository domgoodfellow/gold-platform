# AI and Automation control plane — current-state audit (C8-WO1)

A record of what the AI and Automation code, schema and tests do in the working tree on `main`
(HEAD `7ed5c2b`, plus uncommitted work elsewhere that this audit does not touch), taken from
source and migrations rather than from comments. Nothing here builds anything. §6 is a proposed
decision record for the slices that follow; it is not yet in `constraints.md`.

**Status words:** CANONICAL, PARTIAL, DUPLICATE, LEGACY, UNUSED, MISSING, UNCLEAR.

**Not read.** The work order was cut off in the middle of C8.02 (after "Do not design this from
theory"), so anything it asked for after that point is not covered. Section 3.7's outcome and the
UI inventory (§3.8) were read from source only; no screen was opened in the running app, so no
claim below says a screen *works*.

---

## 1. The short answer

There are **three separate model-calling paths**, **two separate "something the assistant can do"
vocabularies plus a third for Automation**, and **one approval mechanism that is real but covers
exactly one action**. The authorization spine for *reading* is sound and should be kept. The gaps
are on the *doing* side and on *measuring*.

| # | Finding | Where |
|---|---|---|
| 1 | The operator loop is correct and should be the one loop. It forwards the asker's own token; there is no assistant role. | `apps/api/app/ai/loop.py`, `api/ai_ask.py` |
| 2 | **Model usage is never recorded.** Meters `ai_tokens_input` / `ai_tokens_output` exist, `writer` is `null` on both, and no code reads token counts from a provider answer. A plan quota over them would promise tracking that does not happen. | `20261105000004`, `app/providers/*/answering.py` |
| 3 | **The assistant has no entitlement check.** `askQuestion` checks the `assistant.ask` capability and nothing else. `check_module_entitlement` is attached to `card_payments` only, so an unpaid or unwanted `assistant` module does not stop a question. | `lib/domain/assistant/questions.ts:336` |
| 4 | **Three paths call a model; only two honour the platform's provider assignment.** The configuration-drafting adapter in `apps/web` hard-codes a model and reads its own `ANTHROPIC_API_KEY`, bypassing `platform_ai_runtime_assignments`. | `lib/adapters/drafting/anthropic.ts:40`, `registry.ts:10` |
| 5 | **Automation re-implements domain behaviour in SQL.** Its four actions are inline `UPDATE`/`INSERT` statements inside `app.run_automation`, not calls to the operations a person uses. | `20260831000006_counters.sql:274–400` |
| 6 | **"What the assistant can do" is not one thing.** Tools (6 Postgres functions), Actions (1 whitelist entry), Python domain commands (3 domains, HTTP only), Automation actions (4 SQL branches), and web server actions are five lists with no shared shape. | §3.2 |
| 7 | **Approval is real but single-purpose.** It is persisted, server-enforced and frozen after decision — for one action. It is not tied to a hash of the exact inputs, and it does not expire. | `questions.ts:480`, `20260902000007` |
| 8 | **The audit chain breaks at the run row.** A run records tool names and row counts; an executed action is not linked to the `events` row it caused, and neither carries a request id. | §3.6 |
| 9 | **`assistant_resource_grants` has no consumer.** The question an assistant tool must ask exists; no tool asks it. | `lib/domain/integrations/assistant-grants.ts` |
| 10 | **The public assistant's `instructions` are tenant-written text placed in the model `context`**, which `loop.py` documents as application state only. | `api/public_chat.py:26` |

---

## 2. C8.01 — Inventory

### 2.1 AI runtime

| Concept | Canonical files | Persistence | Runtime owner | Callers | Status | Problems |
|---|---|---|---|---|---|---|
| Tool loop (iteration, dispatch, cap 6, record) | `apps/api/app/ai/loop.py` | none (returns `Answer`) | Python | `ai_ask.py`, `public_chat.py` | **CANONICAL** | Records names and counts only; no token or latency capture |
| Provider contract | `app/ai/__init__.py` (`AnsweringProvider`, `Turn`, `Tool`, `ToolCall`) | none | Python | the loop | **CANONICAL** | Carries no usage figure, so metering cannot be added without widening it |
| Provider implementations | `app/providers/{anthropic,openai,google,openai_dialect}/answering.py` | none | Python | `app/ai/adapters.py`, `registry.py` | **CANONICAL** | None return token counts |
| Provider selection (assigned) | `app/ai/runtime.py`, `adapters.py` | `platform_ai_runtime_assignments` | Python reads, staff write | `ai_ask.py`, `public_chat.py` | **CANONICAL** | Two capabilities only; never fails over (intended, D62) |
| Provider selection (environment fallback) | `app/ai/registry.py` | env vars | Python | `runtime.py` when no assignment | **LEGACY** | Documented as deployment compatibility; hard-codes `claude-opus-5` |
| Model assignment UI/domain | `lib/domain/ai/runtime.ts`, `features/platform/ai-runtime/*` | same table, via overview/record RPCs | Web + Postgres | Platform → AI runtime page | **CANONICAL** | Capability list is duplicated in TS, SQL check and Python strings |
| Conversations | `lib/domain/assistant/questions.ts` | `agent_conversations` (creator-only select) | Web | `features/agent/actions.ts` | **CANONICAL** | Operator rail only; public chat uses a different table |
| Runs (a question and its answer) | `questions.ts` `askQuestion` | `agent_runs` | Web writes, under asker's session | rail | **CANONICAL** | Written by `apps/web`, not by the runtime that did the work |
| Tool call / result history | `ToolRecord` in `loop.py` | `agent_runs.tools` (jsonb) | Python produces, Web stores | rail | **PARTIAL** | Name, arguments, row count, error. No duration, no tokens, no result hash |
| Context construction | `questions.ts` (date + `describeViewing`), `loop.py` (prior turns, attachments) | none | Web builds, Python bounds again | `ai_ask.py` | **CANONICAL** | Bounds restated in two runtimes (intentional) |
| System prompt / instructions | inside each provider's `answering.py` | none | Python | providers | **UNCLEAR** | Not read in this audit; one copy per vendor adapter is a drift risk |
| Prompt templates | none found | — | — | — | **MISSING** | — |
| Structured output | drafting adapter only (`anthropic.ts`, constrained decoding) | `configuration_proposals` | Web | Setup | **CANONICAL** for that path | Not used by the loop |
| Assistant definitions | `ai_assistants`, `ai_assistant_deployments` | `20260923000001` | Web reads; Python receives `instructions` | public chat only | **PARTIAL** | The operator assistant has no definition row — it is code |
| Assistant knowledge | `ai_assistant_knowledge_sources` | same migration | — | none | **UNUSED** | `public_assistant_deployment` does not return it, so nothing reaches the model |
| Retries | none | — | — | — | **MISSING by design** | `gold-api.ts` states a retry is a second bill |
| Error handling | `loop.py` (`failed` outcome), `ai_ask.py` (503) | `agent_runs.outcome/detail` | both | rail | **CANONICAL** | — |
| **Configuration drafting** | `lib/adapters/drafting/anthropic.ts` | `configuration_proposals` | Web (SDK in `apps/web`) | Setup | **DUPLICATE** of the model path | Own env key, own hard-coded model, no assignment, no usage |
| **Public assistant** | `app/api/public-communication/route.ts` → `api/public_chat.py` | `communication_threads/entries`, rate-limit table | Web route + Python | website chat widget | **PARTIAL** | Shared-secret auth; `token=''`; `deploymentId` accepted but unused; no run row; no usage |

### 2.2 Tools, actions and commands — every "something the assistant can do"

Not merged here. Five lists exist.

| List | Definition | Read/write | Authority | Execution record | Status |
|---|---|---|---|---|---|
| **Tools** (6): `work_at_risk`, `customers_not_contacted`, `schedule_ahead`, `invoiced_and_incurred`, `work_marked_complete`, `time_committed` | `app/ai/tools.py` → one `stable security invoker` Postgres function each | read only, enforced by Postgres | caller's JWT + RLS | `agent_runs.tools` | **CANONICAL** |
| **Actions** (1): `propose_reschedule`; public: `escalate_to_human` | `app/ai/actions.py`; no function name | proposal only; loop stops | the executor in `lib/domain/assistant/actions.ts` | `agent_runs.proposed_action`, `action_outcome` | **PARTIAL** — the whitelist is in the other runtime by design (D34) |
| **Python domain commands**: `change_customer_stage`, `wrap_up_call`, call routing | `apps/api/app/domains/{crm,communications}` | write | caller's JWT, `security invoker` RPCs | none beyond `events` | **PARTIAL** — reachable by HTTP only; the docstring says "an AI tool or a worker reaches the same pipeline" but neither does |
| **Automation actions** (4): `change_status`, `notify`, `shift_schedule`, `create_work_item` | `ACTION_KINDS` in `rules.ts`; branches in `app.run_automation` | write | `app.acting_automation()` | `automation_runs`, `events` | **DUPLICATE** of domain operations — see §2.3 |
| **Web server actions** | `app/**/actions.ts` calling `lib/domain/**` | write | caller's session | `events` | **CANONICAL** for people |

Observations that matter:

- Tools carry no `reads`/`writes`, entitlement, permission or side-effect metadata. The only
  guarantee is the `provolatile` check in `ai-tools.test.ts`.
- An Action has no declared permission. Its authority is whatever the underlying domain function
  and RLS happen to require when the person presses the button.
- Nothing links an Action to a Python domain command, or to an Automation action kind that does
  the same job (rescheduling exists as `propose_reschedule`, as `shift_schedule`, and as the
  schedule form).

### 2.3 Automation

| Concept | Where | Status |
|---|---|---|
| Rule, condition, action definitions | `automation_rules/conditions/actions` (`20260831000002`+); `lib/domain/automation/rules.ts` | **CANONICAL** |
| Triggers (4): `event`, `schedule`, `external_reading`, `counter_threshold` | `TRIGGER_KINDS`; `app.fire_event_automations`, tick | **CANONICAL** |
| Runtime | `app.run_automation` (Postgres, security definer, own subtransaction per rule) | **CANONICAL** (D30) |
| The clock | `api/automation_tick.py`: fetch readings → `run_due_automations` → drain queued messages | **CANONICAL**; decides nothing |
| Run history | `automation_runs` (snapshots the rule name; no FK, by design) | **CANONICAL** |
| Chaining guard | both triggers return when `app.acting_automation()` is set | **CANONICAL** |
| Templates | `message_templates`, five placeholders | **CANONICAL** |
| Enable/disable, tenant scope | `automation_rules.enabled`, RLS | **CANONICAL** |
| UI | `/automations` (Rules, Messages, Activity), `features/automations/*` | wired to the domain layer; not opened in the running app in this audit |
| AI actions in Automation | `ai_classify_action`, `ai_generate_action` | **MISSING** — catalogue rows with status `planned` only |
| Retry / queue | message drain only; no action retry | **PARTIAL** |

**Does Automation invoke domain behaviour?** No. It **mutates persistence directly**, and in a
second implementation:

| Action kind | What `run_automation` does | The operation a person uses |
|---|---|---|
| `change_status` | `update work_items set status_id` + inserts an `events` row | `change_work_item_status` |
| `shift_schedule` | `update work_items set scheduled_during` | `schedule_work_item` |
| `create_work_item` | `insert into work_items` | `create_work_item` |
| `notify` | `insert into message_deliveries`, drained by `automation_tick.py` | the Communications `messages` path (`sendMessage`, email/SMS lifecycle, D72–D76) |

The constraints it relies on (`check_status_transition`, the resource exclusion constraint) still
fire, so these are not *unsafe* today. They are a **second place to change** every time the real
operation gains a rule — and `notify` is already a second outbound-message pipeline beside
Communications, with its own table and its own sender loop.

It does not call provider APIs directly; the tick's sender goes through `app.channels`.

### 2.4 Authorization on the AI path

| Question | Operator assistant | Public assistant | Automation |
|---|---|---|---|
| **Actor** | Forwarded user JWT, verified by `require_caller` | None. `token=''` | Fixed actor uuid `…0a2`, `app.acting_automation()` |
| **Organization** | Sent by the browser, dropped from model args, enforced by RLS | Resolved server-side from the deployment row | From the rule row |
| **Permission** | `assistant.ask` checked in `askQuestion`; tools use RLS only; actions use the domain function's own rules | None needed — no tools | `automation.manage` authors; runtime checks nothing further (tested, intentional) |
| **Resource** | `assistant_resource_grants` + `assistant_may_read_resource` exist; **no tool consults them** | n/a | n/a |
| **Entitlement** | **Not checked** | **Not checked** | Module `automations` via navigation; no write-time enforcement |

So of the five facts, only *actor* and *organization* are resolved explicitly. *Permission* is
implicit (RLS). *Resource* is not wired. *Entitlement* is absent. This matches CLAUDE.md's
statement that write enforcement is proven only for `card_payments`.

### 2.5 Approval and action safety

| Mechanism | Persisted | Server-enforced | Tied to exact inputs | Reusable | Expires | Auditable |
|---|---|---|---|---|---|---|
| Intended action (`agent_runs.proposed_action`) | yes | yes — `executorFor` whitelist, `agent_runs_update` freezes a decided action | yes, by being the stored row (arguments are not re-hashed, but are read back, not taken from the client) | no (frozen once decided) | **no** | partly — outcome, detail, time; **no decider** column beyond `created_by` |
| Configuration proposal (`configuration_proposals`) | yes | yes — reads the row, not the caller's copy | yes | no (re-apply is a new draft) | no | yes |
| Automation rule review (`review.ts`) | n/a — warnings only | no | n/a | n/a | n/a | n/a |
| Public `escalate_to_human` | recorded as `handoff` on the thread | yes | n/a | n/a | n/a | thread entry |

The pattern is correct. It is built twice (agent actions, configuration proposals) with different
tables and states, and neither has an expiry or a recorded approver distinct from the asker.

### 2.6 Audit and execution history

| Record | Holds | Gap |
|---|---|---|
| `agent_runs` | question, answer, tool names/args/row counts, `answered_by`, action state | No usage, no latency, no link to what the action changed |
| `events` | actor, entity, action, payload | Automation writes it with the fixed automation actor and snapshots the rule name; an assistant-executed reschedule appears as the **person** with no mark that it came from a run |
| `automation_runs` | rule snapshot, outcome, detail | Not linked to the events it caused except by payload |
| `usage_events` | metered consumption via `app.record_usage` | No AI writer (§2.7) |
| Request or correlation id | none in the AI path | `grep` finds ids only in Stripe/Resend/payments code |

**The chain** *user request → assistant run → tool → mutation → provider call → result*
**breaks at three places:** (1) a tool call is a name and a count, not a reference to rows;
(2) `decideOnAction` does not store the `events` row (or work item version) it produced, and the
resulting event does not name the run; (3) there is no id shared between the run, the domain call
and any provider call. Every link up to "run" exists; after the approval button it is inference.

### 2.7 AI usage and commercial metering

- Meters `ai_tokens_input` and `ai_tokens_output` exist in `platform_meters` and are named by
  catalogue features (`ask_gold`, `ai_call_summary`, `ai_receptionist`, the two automation AI
  actions). `ask_gold` is `available`; the rest are `planned`.
- `platform_meters.writer` is `null` for both, and the schema comment says this is deliberate: a
  quota over a meter nobody writes would promise tracking that does not happen.
- `app.record_usage` is the single usage writer and already accepts provider, resource, account
  and rate provenance. `platform_provider_rates` is keyed by `(provider_key, meter_id, currency,
  effective_from)`, which fits two vendors answering one meter.
- Plan `gold_internal` carries an `ai_tokens` allowance row (5,000,000 per month); nothing
  decrements it.

**Reusable later, unchanged:** `usage_events`, the two meters, `app.record_usage`, the rate tables
and the allowance resolver. **Needed:** the runtime must surface token counts per call; a writer
must call `record_usage`; `platform_meters.writer` must name it so the architecture test holds.
No new ledger.

### 2.8 User-facing surfaces

| Surface | Route / component | Wired? |
|---|---|---|
| Agent rail (ask, history, attachments, approve/decline) | `features/agent/tenant-agent-rail.tsx`, `features/agent/actions.ts` | Wired to `askQuestion` / `decideOnAction` |
| AI workspace Home | none | CLAUDE.md: "AI has no Home" |
| Assistant configuration (operator) | none | No definition row to configure |
| Public assistant settings | `settings/communications/page.tsx` + `actions.ts` | Wired to `ai_assistants` |
| Model/provider choice | `platform/ai-runtime`, `platform/providers/[providerKey]` | Wired; platform staff only |
| Assistant grants | `lib/domain/integrations/assistant-grants.ts`, `features/integrations/connections/connection-detail.tsx` | Writes grants; no tool reads them |
| Automations | `/automations`, `/automations/rules`, `/messages`, `/activity` | Wired |
| Workflow builder | none — rules are a form | — |
| Approvals queue | none — approval lives inside the rail | — |
| AI usage | `platform/usage`, `platform/package-economics` | Show metered usage; AI rows will be empty |
| Knowledge | Library → Knowledge | Empty-state shell only |

---

## 3. C8.02 — Ownership map

Derived from where behaviour already lives, not from the target diagram.

| Responsibility | Owner today | Evidence | Should the control plane own it? |
|---|---|---|---|
| Deciding what a question means | Model | provider adapters | Yes — the only thing AI owns |
| Which model / vendor answers | Platform (Providers) | `platform_ai_runtime_assignments`, D62 | No; keep |
| Loop iteration, cap, record | `app/ai/loop.py` | one loop, D34 | Yes — the single runtime |
| Read definitions ("at risk", "invoiced") | Postgres functions, by domain | D34, D35 | No — domains |
| Who the caller is | `app/auth`, RLS | D52 | No |
| What the caller may see | RLS | D34 | No |
| Write operations | `lib/domain/**` (TS) and `app/domains/**` (Python, narrow) | D2, D51 | **No — never** |
| Which operations exist for assistants | Hand lists in two runtimes | §2.2 | Needs one declaration |
| Whether the module is wanted/paid | Commercial | D25, D41 | Asked, not decided |
| Approval | Rail + `agent_runs` | §2.5 | Yes — one mechanism |
| Trigger, condition, schedule | Automation (Postgres) | D30 | Yes — Automation |
| Message delivery | Communications (`messages`) | D72–D76 | **No — Automation's `notify` should call it** |
| Usage recording | `app.record_usage` | D65 | Called, never duplicated |
| Provider calls | Python adapters | I15 | No |

Boundary rule the audit supports: the control plane owns **selection, preview, approval and the
record**. It owns no business rule, no provider call and no table of business state.

---

## 4. C8.03 — Domain operation gap matrix

The question: for each capability the target diagram implies, what exists as an authoritative
operation that **both** an assistant and Automation could call, and what only exists as a screen
action or inline SQL?

| Capability | Authoritative operation | Staff UI | Assistant | Automation | Gap |
|---|---|---|---|---|---|
| Reschedule a job | `schedule_work_item` (TS wrapper `scheduleWorkItem`) | yes | via `propose_reschedule` (TS executor) | **raw `UPDATE`** (`shift_schedule`) | Automation bypasses the operation |
| Change a job's status | `change_work_item_status` | yes | none | **raw `UPDATE`** | same |
| Create a job | `create_work_item` | yes | none | **raw `INSERT`** | same |
| Message a customer | Communications `sendMessage` / email / SMS lifecycle | yes | none | **`message_deliveries` queue**, own sender | Two outbound pipelines |
| Move a customer's pipeline stage | `change_customer_stage` (Python command + RPC) | yes | none | none | Not exposed as a tool or action |
| Wrap up a call | `wrap_up_call` | yes | none | none | same |
| Create a customer from a conversation | `createCustomerFromConversation` | yes | none | none | same |
| Create / update a rule | `lib/domain/automation/rules.ts` | yes | none | n/a | No assistant path; fine |
| Invoice, payment | Finance domain | yes | none | none | Intentionally unreachable today |
| Place a call / send SMS | Communications | yes | none | none | Spends money; needs approval and metering first |
| Provider configuration, DNS, publishing | staff-only definer functions | staff | none | none | Should stay unreachable by AI |
| Read business state | six tool functions | via screens | yes | via conditions | Read side is complete for the questions it was built for |
| Record AI usage | `app.record_usage` | n/a | **not called** | n/a | Missing writer |
| Check entitlement before use | `check_module_entitlement` | n/a | **not applied** | not applied | Only `card_payments` |
| Check an assistant resource grant | `assistant_may_read_resource` | n/a | **not called** | n/a | Unconsumed |

Pattern: the read side is uniform; the write side has four real operations an assistant could use
that no assistant can reach, and four that Automation re-implements.

---

## 5. Things wrong in the repository today

Named rather than worked around, as `CLAUDE.md` asks.

1. **Two sections numbered D75** in `docs/constraints.md` (Forms, and SMS). One is mis-numbered;
   the next free number is D78.
2. **`loop.py` says `context` is application state, never tenant words.** `public_chat.py` puts
   tenant-written instructions into it. Either the rule or the call is wrong.
3. **`public_chat.py` accepts `deploymentId` and ignores it.** It is validated as required and
   then used nowhere.
4. **`ai_assistant_knowledge_sources` has no reader.** The deployment function omits it.
5. **`app/domains/crm/stages.py` documents a caller that does not exist** ("an AI tool or a worker
   reaches the same pipeline").
6. **`DEFAULT_ANTHROPIC_MODEL` and the drafting `MODEL` are two hard-coded copies** of a model id.
7. **The capability list `('operator_assistant','public_assistant')` is written in four places:**
   the SQL check, two Python strings and `AI_CAPABILITIES`.

---

## 6. C8.04 — Proposed decision record (not yet in `constraints.md`)

### D78 — One operation list, three callers; AI selects, Automation sequences, domains execute

**Decision.** Extend the existing pieces rather than add a registry. The **Action list**
(`app/ai/actions.py` plus the whitelist in `lib/domain/assistant/actions.ts`) is the seed of the
operation list; it grows to carry, per entry, the domain function it calls, the capability it
needs, the Module/Feature entitlement it belongs to, and whether it needs approval. The **Tool
list** stays as the read list. Automation's action kinds become calls to those same domain
operations instead of inline SQL. No new table is created by this decision; if one is needed
later it is justified by its first caller.

**Why.**
- The verified authorization spine (caller's own JWT, RLS, no assistant role) is already right
  and is the hardest part to retrofit.
- The write side is the unfinished part: four operations exist that nothing AI-side can reach,
  and four duplicates sit in SQL.
- The approval pattern already exists and is persisted and server-enforced; building a second
  engine would repeat the duplication this audit found between agent actions and configuration
  proposals.

**Load-bearing.**
1. A model's output is an untrusted request; the operation's own validation and RLS decide.
2. An operation is declared once. A second caller calls it; it does not copy it.
3. Entitlement, permission and resource grant are resolved *before* a preview is shown, not after
   a button is pressed.
4. Every model call records usage through `app.record_usage` against the existing AI meters.
5. An executed operation records which run caused it, so the chain in §2.6 closes.
6. Automation keeps its trigger/condition/schedule engine (D30) and loses its private copies of
   the actions.

**Not decided here.** Whether the executor stays in `apps/web` or moves to a shared Postgres
function per operation; whether approvals gain an expiry and a recorded approver; how public-chat
and operator conversations relate. Each needs its own caller first.

### Proposed slice order

1. **Close the measurement and entitlement gaps** — return token counts from the provider
   contract; write `ai_tokens_*` via `record_usage`; set the meters' `writer`; apply
   `check_module_entitlement`'s question to `askQuestion` and to the public path. *Smallest, and
   everything after it spends money.*
2. **Route the drafting adapter through the assignment** and delete its hard-coded model and key.
3. **Make Automation actions call the real operations** (status, schedule, create-job first;
   `notify` last because it merges two message pipelines). Each keeps its existing refusals.
4. **Expose the existing write operations as declared Actions** with a capability and approval
   flag — `change_customer_stage` first, since it already has a Python command and an RPC.
5. **Close the audit chain** — store the resulting event id on the run and the run id in the
   event payload; add one request id.
6. **Wire `assistant_may_read_resource`** into the first tool that reads a connected app.

### Invariant this audit newly states

None is newly enforced; this is a discovery document. The rows in §5 and the gap matrix in §4 are
the backlog the `Enforced by` and `Held by` columns do not yet cover.

---

## 7. Implementation evidence (C8-WO2) — findings 2, 3, 4 and 10 closed

Appended; nothing above was edited, so §1–§6 stay the record of the tree before this work.

| Finding | Now | Where |
|---|---|---|
| 2 — usage never recorded | `Turn.usage` carries each provider's own report; the loop sums every call; `public.record_ai_usage` is the writer of both meters (`platform_meters.writer` set in the same migration) | `app/ai/__init__.py`, `loop.py`, `metering.py`, `20261125000001` |
| 3 — no entitlement on the assistant | `app.module_entitled` asked by `apps/api` before a provider is resolved: as the caller for the operator endpoints, from a deployment id for the public one | `app/ai/entitlement.py`, `ai_ask.py`, `public_chat.py` |
| 4 — drafting bypasses the assignment | `configuration_drafting` is an assignment; the web adapter calls `/ai/draft-configuration` and holds no model, key or SDK | `api/ai_draft_configuration.py`, `lib/adapters/drafting/gold-api.ts` |
| 10 — tenant instructions in `context` | `instructions` is its own parameter, rendered by `app/ai/prompts.render_instructions` beneath the platform's rules | `app/ai/prompts.py`, the four adapters |
| §5.2, §5.3 | Same two as 10 and a `deploymentId` that is now the whole identity of the request | `public_chat.py`, `resolve_public_assistant` |
| §5.6 — two hard-coded model copies | The drafting copy is gone; `DEFAULT_ANTHROPIC_MODEL` remains as the documented environment fallback for an unassigned capability | `app/ai/registry.py` |
| §5.7 — capability list in four places | One SQL function (`app.ai_capabilities()`) for the table check and the write door; Python and TypeScript keep one constant each, pinned by tests | `20261125000001`, `app/ai/runtime.py`, `lib/domain/ai/runtime.ts` |

Still open, unchanged: findings 5 (Automation duplicates domain operations), 6 (five lists of what the assistant can do), 7 (approval is single-purpose), 8 (the audit chain breaks after execution) and 9 (`assistant_resource_grants` is not enforced); §5.1 (two D75 sections), §5.4 (knowledge sources have no reader) and §5.5 (`stages.py` documents a caller that does not exist). D78 remains proposed; the decisions this work made are D83.
