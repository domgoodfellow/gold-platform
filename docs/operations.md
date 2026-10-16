# GildOps Operations & Reliability

## Purpose

This document defines the **canonical operational and reliability model for GildOps in running environments**.

It answers:

- What runtime components must remain healthy?
- Which dependencies are critical, optional or degradable?
- What should be logged, measured and monitored?
- How are health, readiness and failure states interpreted?
- How should incidents be detected, mitigated and recovered?
- Which operations should be repeatable and automated?
- How are capacity, backups, credentials and provider failures handled over time?
- What evidence is required after release to know the system is still working?

Deployment belongs in `docs/deployment.md`.

Testing before release belongs in `docs/testing.md`.

Security and production-access rules belong in `docs/security.md`.

Provider/integration behavior belongs in `docs/integrations.md`.

---

## Reliability objective

GildOps should remain:

- understandable;
- observable;
- recoverable;
- appropriately available;
- safe under partial failure.

A system that works only when every dependency is healthy is not operationally complete.

The operating principle is:

```text
Detect
↓
Understand
↓
Contain
↓
Recover
↓
Learn
```

Do not operate through:

```text
Deploy
↓
Hope
```

---

## Runtime inventory

The current primary runtime components are:

### Web

```text
apps/web
Next.js
Vercel
```

Responsibilities include:

- authenticated application;
- public/customer web experiences;
- server-side route/application composition;
- web-originated domain operations;
- shell/navigation;
- browser-delivered UI.

---

### API

```text
apps/api
Python serverless handlers
Vercel
```

Responsibilities include:

- provider callbacks/webhooks;
- provider operations;
- integration operations;
- AI endpoints;
- communications callbacks;
- scheduled automation execution;
- narrow domain commands.

The API is serverless.

Do not assume a continuously running daemon.

---

### Supabase

Primary stateful dependency:

```text
PostgreSQL
Auth
Storage
Data API / RPC
```

Supabase availability affects most authenticated and domain-backed product behavior.

---

### Scheduler

Current recurring execution is initiated by Vercel Cron.

The schedules and rewrites are owned by `apps/api/vercel.json`: automation ticks and integration
synchronization every 15 minutes, customer notifications every minute. Deployment prerequisites,
plan compatibility and activation gates are in `docs/deployment.md`.

Scheduled work must tolerate:

- delayed invocation;
- duplicate invocation;
- partial provider failure;
- retry.

### Customer notification hold and recovery

These are procedures for a separately authorized environment, not permission to execute them.
The smallest sandbox isolation is a dedicated database containing only synthetic customers, a
dedicated tenant/provider scope and a worker held until the controlled recipient is ready.

Disable the notification schedule in the selected API project's Cron settings first. To stop new
claims and last-moment send authorization independently of shared cron authentication, an authorized
database operator can apply the following notification-only hold after Batch E is installed:

```sql
revoke execute on function public.claim_customer_notification(uuid)
  from customer_notification_worker;
revoke execute on function public.authorize_customer_notification_send(uuid,uuid)
  from customer_notification_worker;
```

Keep `finish_customer_notification` granted so a provider response already in flight can be recorded.
Do not remove the shared `CRON_SECRET`, change provider credentials belonging to other workloads,
delete queued jobs or roll back customer reviews/disclosures. A call already authorized or sent to
the provider may still complete; disabling cannot recall it. Verify no new claims after the hold,
inspect active leases and reconcile uncertain sends against provider evidence before resuming.

The hold requires no schema downgrade and survives an API/Web rollback. Retain queued rows, consent,
attempts and delivery evidence. Leases expire after five minutes; resumption can reclaim expired
jobs using a fresh fencing token, the original canonical message/idempotency key and the provider
account pinned at the first claim. A lease that has expired cannot complete, even unreclaimed; a
definitive provider answer arriving after expiry is kept privately and settles the job on its next
claim instead of a resend. Five claims and the 23-hour first-attempt cutoff still apply. A job that
reaches either bound, or whose sender's provider account changes, after a send was authorized is
held as **Delivery uncertain** rather than failed: an earlier attempt may have been delivered.
Do not move timestamps, reset attempts or create a replacement message to bypass those bounds.
Uncertain jobs require reconciliation against provider evidence.

After dependencies, recipient eligibility and provider reconciliation are confirmed, separately
authorized resumption grants those same two exact function signatures to
`customer_notification_worker`, verifies no additional table/function authority, then re-enables
the selected notification schedule. A migration can re-grant execution; recheck the hold after
every corrective migration and before deploying an automatically scheduled API release.

### Notification diagnostics and intervention

Use CRM Customer -> Service Engagement -> Customer notifications -> Delivery history for the
operator projection. Intent state is not provider acceptance; `messages.external_id` and accepted
events establish acceptance, signed `message_events` establish sent/delivered/bounce observations.
Use `supabase/snippets/customer-notification-readiness.sql` with one explicitly selected organization
for aggregate queue/attempt/callback evidence. It reads private job state under an authorized
operational connection, grants nothing and returns no email addresses, message bodies or secrets.
Vercel Cron/runtime logs establish whether scheduled execution actually occurred. A successful
HTTP invocation with all-zero counters cannot distinguish an empty queue from a broken schedule.
There is no persisted worker heartbeat; correlate invocation logs with due-job age.

| Symptom | Evidence and initial intervention threshold |
| --- | --- |
| No intents | CRM/history and scoped intent count. Check whether the domain action explicitly requested notification. |
| No eligible recipients | Intent reasons, consent/suppression and sender configuration. Do not infer an outage from intentional suppression. |
| Worker absent / queued | Due jobs older than 10 minutes, or no scheduled invocation for 3 expected minutes while due work exists: inspect hold, route, auth, plan and runtime logs. |
| Repeated failures | 3 or more claims on one job, or any exhausted/23-hour-cutoff job: inspect attempt outcomes; do not reset counters. |
| Claim failures | 3 consecutive 401/404/503 or database errors: hold processing, verify deployment/configuration/grants. A deliberate hold is expected to refuse claims. |
| Provider rejecting | First rejection in the controlled acceptance, or 3 rejections in 15 minutes: pause and verify sender/account readiness before retrying. |
| Delayed / missing webhook | Accepted more than 15 minutes without sent/delivery evidence: inspect provider webhook delivery and canonical message ID correlation. Delay is not proof of bounce. |
| Bounce / suppression spike | Any unexpected bounce/complaint in the controlled test, or 3 new suppressions in 15 minutes: stop new test sends, review eligibility and provider events. Never clear suppression to force acceptance. |

These are investigation triggers, not customer SLAs. Tune them from approved sandbox observations.
Use existing Vercel logs, Supabase diagnostics, Resend delivery logs and canonical Communications
records; no additional monitoring platform is needed. Runtime counters expose accepted/retry/failed/
held, but neither provider details nor credentials should be logged. A finish RPC failure can leave
an uncertain leased send; preserve its stable IDs and investigate before any retry.

### Tenant-email webhook acceptance plan

Use `https://<approved-api-origin>/webhooks/tenant-email`, rewritten by `apps/api/vercel.json` to
`api/tenant_email_webhook.py` (POST). The API origin is unresolved until the intended project is
accessible; never substitute an unrelated project. Reuse this endpoint for notifications.
Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
`email.failed`, `email.complained` and `email.suppressed`. Existing optional `email.opened` /
`email.clicked` events are engagement history, never proof of reading or approval. Do not enable
`email.received` merely for this outbound acceptance: it invokes the separate inbound-email flow.

The destination's `TENANT_EMAIL_WEBHOOK_SECRET` is scoped to the selected tenant-mail account;
platform invitation events remain on `/webhooks/invitation-email` with `RESEND_WEBHOOK_SECRET`.
Current ingress has one configured tenant-email secret, not per-account dynamic signature lookup.
An isolated account with a different secret therefore needs its isolated API environment.
Verify public POST accessibility without redirects or deployment-auth interception before acceptance.

Signature verification covers raw bytes with Svix ID/timestamp/signature and a five-minute clock
tolerance before JSON parsing. Invalid signatures return 400; unconfigured ingress returns 404;
valid unknown/untracked/duplicate events return 200; persistence failures return 500 for provider
retry. Organization/message are derived from the already stored provider message ID, never callback
tenant/customer input. The provider event ID deduplicates ingestion. Replay through the provider's
delivery tools uses a fresh signed request while retaining the event identity; replaying stale raw
headers should be refused. Resend retries non-2xx delivery; inspect the current provider retry policy
and endpoint logs rather than assuming every callback will arrive. Provider references:
[retries and replays](https://resend.com/docs/webhooks/retries-and-replays),
[24-hour idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), and
[test addresses](https://resend.com/docs/dashboard/emails/send-test-emails).

### Acceptance evidence and release blockers

Store each controlled run in the existing protected operational evidence system, with:
environment; selected tenant/Customer/Engagement/Review; source commit; migration version; API and
Web deployment identities; schedule and genuine invocation timestamp; intent ID; canonical message
ID; provider message ID; provider event ID/timestamp and ingestion time; expected/observed result;
evidence class (`real provider`, `simulated provider`, `not tested`, `blocked`); operator and approved
traffic scope. General reports redact personal addresses and contain no codes, tokens or credentials.

The prepared provider journey creates fixtures through canonical operations, uses a controlled
mailbox for actual verification and opt-in, releases one notified review, observes acceptance then
signed delivery in CRM, safely retries one transient failure with the same message key, confirms
duplicate callback handling and withdraws consent before a later queued send. Capture before/after
counts for every other tenant and recipient; no change is the isolation criterion. Provider testing
addresses may separately validate bounce/delivered callbacks after explicit sending approval.

The deterministic acceptance matrix uses
`apps/web/tests/integration/database/service-notifications.test.ts` for canonical database
operations, `apps/api/tests/component/test_customer_notifications.py` for simulated dispatch,
and `apps/api/tests/component/test_handlers.py` plus
`apps/api/tests/contract/test_resend_webhook.py` for signed ingress. These fixtures do not prove
mailbox ownership, hosted routing or real provider delivery.

| Scenario | Required result and local coverage |
| --- | --- |
| Verified, opted-in recipient | Eligible after session-bound code confirmation; database fixture. |
| Unverified recipient | No service notice from Portal access alone; database fixture. |
| Consent withdrawn | Queued notices suppressed and pre-send authorization refused; database and simulated dispatch fixtures. |
| Sender domain not ready | Claim held or failed without successful dispatch; database fixture. |
| Provider unavailable | Same message retried with durable unavailable evidence; simulated dispatch and database retry fixtures. |
| Duplicate worker invocation | Concurrent claim refused; retries retain the canonical provider idempotency key. Actual provider deduplication remains untested. |
| Expired lease | Completion after expiry is refused with or without reclamation; a late definitive answer settles the job on the next claim; concurrent completion of one lease succeeds once. Database fixtures. |
| Early provider callback | Held privately (bounded) until acceptance records its provider ID, then applied once in provider order; racing callbacks are serialized with acceptance. Database fixtures. |
| Provider account rebinding | Retries use the account pinned at first claim; credential rotation keeps it; a change after a possibly delivered attempt holds the delivery as uncertain. Database and simulated dispatch fixtures. |
| Worker execution budget | Monotonic 240-second invocation deadline, per-call timeouts, completion reserve, 60-second lease margin before authorization, 3-second lock waits and a 5-second worker statement timeout. Simulated dispatch and database fixtures. |
| Superseded review | Obsolete pending notice suppressed; database fixture. |
| Delivered / bounced callback | Canonical evidence and suppression updated, duplicate ignored; simulated database events and signed ingress fixtures. |
| Invalid signature | Refused before persistence; signed ingress fixture. |
| Unknown provider message | Acknowledged without tenant correlation; database and ingress fixtures. |
| Wrong customer | Canonical operation refused without creating an intent; database fixture. |

No hosted acceptance tenant or tester-controlled mailbox is selected. Selecting them requires the
specific sandbox and recipient authorization; local synthetic fixtures are the only prepared
executable environment. Provider acceptance and genuine scheduled execution remain blocked.

Batch F review of `bbf4f1c` identified four release concerns, corrected by migration
`20261222000001_customer_notification_delivery_reliability.sql` and the bounded worker in
`app/services/tenant_email/notifications.py`:

- Lease fencing: `finish_customer_notification` completes only the current, unexpired lease. An
  expired lease's late `accepted`/`rejected` answer is private evidence (`app.notification_send_evidence`)
  that the next claim settles; it is never treated as proof that nothing was sent.
- Early callbacks: a signed callback whose provider message ID is not yet recorded is held in
  `app.email_early_events` (48 hours, 20 per provider message, 10,000 overall, 16 KB payloads) and
  replayed through the canonical Communications event path when acceptance records the ID.
  Acceptance and callbacks for one provider message ID are serialized by an advisory lock.
- Provider scope: the job pins provider and account on first claim and records when a send was
  first authorized. Retries read the pinned account's current credential. A changed account before
  any authorized send is taken up and noted on the attempt; after one, the job is held as uncertain.
- Execution budget: the worker claims only when a whole job fits in its 240-second deadline, bounds
  every call, keeps a completion reserve and stops after a failed completion. The database refuses
  to authorize a send with under 60 seconds of lease left and bounds the worker's lock waits and
  statements.

Local fixtures prove these contracts; they do not prove Resend's idempotency scope across key
rotation, hosted PostgREST role settings or real callback ordering. Do not claim production
readiness from the local suite. Hosted acceptance, accessible intended projects, sender/account/
domain setup, the controlled mailbox and explicit external-action authorization remain separate
release gates.

---

## Dependency classes

Operational dependencies should be classified by product effect rather than merely listed.

---

### Core dependencies

Failure significantly affects broad application availability.

Examples:

- Vercel web runtime;
- Vercel API runtime for API-owned features;
- Supabase database;
- Supabase Auth.

Core dependency failure should produce high-priority operational attention.

---

### Feature-critical dependencies

Failure disables an important capability but not the entire platform.

Examples may include:

- Twilio for configured telephony/messaging;
- Resend for configured email delivery;
- Stripe for configured payments/billing;
- AI provider assigned to an AI capability;
- DNS/web delivery provider for domain operations.

The affected feature should fail clearly while unrelated product areas remain usable where possible.

---

### Optional dependencies

Failure removes enhancement or optional capability.

Examples can include:

- geocoding;
- map tile/style provider;
- optional external data source;
- non-critical analytics.

Optional dependency failure should degrade gracefully.

Do not make an optional provider a global readiness dependency.

---

## Liveness, readiness and capability health

These concepts are different.

### Liveness

Answers:

> Is the runtime/process responding?

Example:

```text
web route answers HTTP
```

---

### Readiness

Answers:

> Can this runtime perform the core useful work it is expected to perform?

Readiness should account for required dependencies only.

Do not mark the entire platform unready because an optional integration is unavailable.

---

### Capability health

Answers:

> Can this specific feature currently operate?

Examples:

```text
tenant email
telephony
AI answering
Stripe billing
Google connection
custom-domain provisioning
```

Capability health may be degraded while core GildOps remains healthy.

---

## Current smoke signal

The deployed smoke suite provides a minimal broad signal:

```text
application answers
login renders
session can be established
authenticated shell loads
```

This proves basic web + Auth + database-backed membership reachability.

It does not prove:

- provider health;
- all workspaces;
- automation scheduler;
- email;
- telephony;
- billing;
- AI.

Use capability-specific observation for those.

---

## Observability model

Operational evidence should use three major signal types where the runtime supports them:

```text
Logs
Metrics
Traces / correlation
```

Do not require all three everywhere before producing useful observability.

Start with structured evidence that answers real operational questions.

---

## Logs

Logs should record discrete operational facts.

Useful fields include:

```text
timestamp
environment
operation
request_id / operation_id
organization_id where safe/relevant
actor type/id where safe/relevant
provider / connector
external event/resource ID
result
error category
latency
retry attempt
```

Prefer structured logs over free-form paragraphs for machine-operated paths.

---

### Logging rules

Do not log:

- passwords;
- API keys;
- OAuth access/refresh tokens;
- webhook secrets;
- authorization codes;
- raw private credential values;
- sensitive provider payloads without a real diagnostic need.

See `docs/security.md`.

---

## Correlation

Distributed work should carry a stable identifier where practical.

Useful identifiers include:

```text
request_id
operation_id
job_id
provider_event_id
import_run_id
automation_run_id
usage_event_id
```

Correlation is especially important for flows such as:

```text
browser
↓
web
↓
API
↓
database
↓
provider callback
```

Without correlation, each layer may look healthy while the end-to-end operation fails.

---

## Metrics

Operational metrics should answer actionable questions.

Core categories:

### Traffic

Examples:

- requests;
- automation runs;
- messages/calls;
- provider operations;
- imports;
- AI runs.

---

### Errors

Examples:

- request failures;
- database/RLS errors;
- provider failures;
- webhook verification failures;
- automation-run failures;
- failed imports;
- failed billing callbacks.

---

### Latency

Examples:

- web/API request latency;
- provider request latency;
- AI response latency;
- database query/function latency;
- scheduled job duration.

---

### Saturation / capacity

Examples:

- database connections;
- database size;
- storage usage;
- function concurrency;
- provider quotas;
- rate-limit pressure;
- queue/backlog equivalent;
- automation due-work backlog.

---

## Business vs operational metrics

Business metrics and operational metrics serve different questions.

Business:

```text
new customers
invoices sent
work completed
```

Operational:

```text
API error rate
provider failures
automation lag
database saturation
```

Both may appear in GildOps reporting, but do not confuse business performance with system health.

---

## Monitoring

Monitoring continuously evaluates known signals.

High-value monitoring should cover:

- core availability;
- authentication failure rate;
- database connectivity/errors;
- API errors;
- scheduled-task execution;
- provider callback failures;
- provider credential/readiness failures;
- billing/communications failures;
- elevated latency;
- data/capacity thresholds.

Do not alert on every anomalous metric.

---

## Alerts

An alert should require attention.

A useful alert answers:

```text
What is wrong?
How severe is it?
What is affected?
When did it begin?
Where should I look?
```

Where practical, include links/references to:

- logs;
- deployment;
- provider dashboard;
- runbook;
- affected operation.

---

### Symptom-first alerting

Prefer user-visible failure signals where possible.

Example:

```text
tenant email send failure rate elevated
```

is often more actionable than:

```text
one serverless function briefly used more CPU
```

unless the infrastructure signal itself predicts imminent failure.

---

## Severity model

Use a simple severity model until scale justifies more detail.

### SEV-1 — Critical

Examples:

- widespread inability to log in/use core product;
- cross-tenant data exposure risk;
- destructive data corruption;
- platform billing/security incident with material impact;
- broad customer-facing outage.

Response:

- immediate containment/mitigation;
- protect users/data first;
- restore service;
- then complete diagnosis.

---

### SEV-2 — Major

Examples:

- major workspace unavailable;
- communications/billing failure affecting many Organizations;
- automation broadly failing;
- significant provider outage without safe fallback.

Response:

- prompt operator attention;
- defined mitigation;
- active monitoring until stable.

---

### SEV-3 — Degraded

Examples:

- one optional integration unavailable;
- elevated but bounded failure rate;
- non-critical public feature degraded;
- isolated Organization provider issue.

Response:

- diagnose and repair according to impact;
- avoid unnecessary emergency change.

---

## Incident response

During an incident, priority is:

1. protect people, customer data and financial integrity;
2. contain blast radius;
3. restore useful service;
4. preserve evidence;
5. diagnose root/contributing causes;
6. implement durable correction.

Perfect diagnosis is not required before safe mitigation.

---

## Incident state

Maintain concise factual state:

```text
Impact
Current status
Affected scope
Mitigation
Next action
```

Do not publish speculative root cause during active diagnosis.

---

## Mitigation vs fix

A **mitigation** reduces current impact.

A **fix** removes the underlying defect.

Examples of mitigation:

- disable one provider-backed feature;
- revert application deployment;
- stop a faulty automation;
- rotate a compromised credential;
- temporarily pause provisioning;
- direct traffic away from a failing optional path.

A mitigation can be correct even when the permanent fix comes later.

---

## Incident timeline

For meaningful incidents, capture:

- first known impact;
- detection;
- investigation steps;
- mitigation;
- recovery;
- relevant changes/deployments/provider events;
- final resolution.

Use timestamps.

Do not reconstruct a critical incident only from memory several days later.

---

## Postmortems

A postmortem is appropriate when the incident had meaningful:

- customer impact;
- security/data risk;
- recovery difficulty;
- detection failure;
- repeat potential.

Record:

- what happened;
- impact;
- timeline;
- contributing causes;
- why safeguards failed or were absent;
- detection quality;
- mitigation;
- corrective actions.

Focus on system improvement rather than blame.

---

## Runbooks

A runbook describes a repeatable response to a known operational situation.

Useful candidates include:

- Vercel deployment failure;
- Supabase outage/degradation;
- authentication outage;
- database capacity issue;
- automation scheduler not firing;
- stuck/failing automation runs;
- expired provider credential;
- Twilio outage;
- Stripe webhook backlog/failure;
- Resend delivery failure;
- OAuth connector failure;
- AI provider failure;
- custom domain/DNS failure.

---

### Runbook structure

Use:

```text
Symptoms
↓
Confirm / verify
↓
Immediate mitigation
↓
Diagnosis
↓
Recovery
↓
Validation
↓
Escalation
```

A runbook should be usable by someone other than its author.

---

## Deployment operations

Deployments and Production changes are described in `docs/deployment.md`.

Operationally, every release should be followed by:

- smoke;
- changed-journey verification where relevant;
- error/log observation;
- provider callback/operation inspection where changed;
- database/migration verification.

A successful build is not proof of healthy Production.

---

## Rollback and rollforward

Use rollback when the previous application version remains compatible and reverting is the fastest safe mitigation.

Use rollforward when:

- schema/data changes make rollback unsafe;
- provider state already changed;
- the corrective change is narrow;
- old code cannot safely operate with current state.

Operations should understand the difference before a high-risk deployment.

---

## Database reliability

PostgreSQL is critical state.

Operational responsibilities include:

- availability;
- storage/capacity;
- query performance;
- connection pressure;
- migration health;
- backups;
- restoration capability.

---

### Database capacity

Watch for:

- storage growth;
- connection exhaustion;
- slow queries;
- large table/index growth;
- expensive reporting queries;
- unbounded collection reads.

Scaling should follow measured pressure.

Do not wait for hard provider limits before understanding usage.

---

## Backups

Backups are useful only if restoration works.

Production data-protection policy should define:

- provider backup capability;
- retention;
- restoration procedure;
- access;
- RPO;
- RTO.

Do not claim a specific RPO/RTO until the business has deliberately committed to one.

---

### Restore verification

As the product becomes operationally critical, periodically verify:

- a backup can be restored to a safe environment;
- expected schema/data are present;
- application can read the restored state;
- secret/provider dependencies are not accidentally restored into unsafe environments.

A backup that has never been restored is not fully verified.

---

## RPO and RTO

Definitions:

**RPO — Recovery Point Objective**

> Maximum acceptable recent data loss after recovery.

**RTO — Recovery Time Objective**

> Maximum acceptable time to restore required service.

Do not invent contractual numbers.

Set these when customer commitments and platform maturity justify them.

---

## Scheduled work reliability

Current recurring automation is triggered every 15 minutes.

Operationally track:

- last successful tick;
- duration;
- due work found;
- work completed;
- work failed;
- retry/backlog age.

A scheduler invocation succeeding with zero application work does not prove every automation is healthy.

---

## Idempotent jobs

Scheduled/provider jobs must remain safe under duplicate execution.

Use:

- run IDs;
- claim/lease semantics where required;
- immutable event IDs;
- database constraints;
- idempotent provider keys.

Operational retries should not create duplicate charges, messages or work.

---

## Backlog / lag

For asynchronous/scheduled work, measure lag:

```text
now - time work should have run
```

Examples:

- due automation not executed;
- provider event pending processing;
- import stalled;
- billing reconciliation delayed.

Lag often reveals user-visible failure earlier than process-health metrics.

---

## Provider operations

Provider dependencies should expose operational state separately from tenant-facing product state.

Examples:

```text
configured
not configured
verified
verification failed
provider unavailable
remote resource missing
remote changed
rate limited
```

See `docs/integrations.md`.

---

## Provider outages

When a provider is degraded:

1. determine affected capability/Organizations;
2. stop harmful retry storms;
3. preserve canonical GildOps state;
4. queue/defer only if the domain supports safe retry;
5. communicate accurate feature state;
6. reconcile after provider recovery.

Do not convert provider failure into false local success.

---

## Telephony and messaging

Operational concerns include:

- callback verification failures;
- outbound provider failures;
- number/binding readiness;
- delivery status lag;
- recording callbacks;
- provider rate limits;
- per-Organization resource state.

A callback outage can leave local business state incomplete even if call placement itself succeeded.

Reconciliation/inspection should account for this.

---

## Email

Distinguish operational planes:

```text
GildOps platform mail
tenant customer email
auth-provider email
```

A failure in one does not necessarily imply another is down.

Observe:

- provider acceptance;
- delivery events where available;
- signing/domain readiness;
- webhook failures;
- send retries.

---

## Billing/payments

Payment operations require strong operational evidence.

Monitor separately:

```text
tenant payment processing
GildOps platform subscription billing
```

Do not merge their webhooks, errors or signing credentials.

Operational checks should include:

- webhook verification failures;
- processing failure;
- duplicate/retry behavior;
- subscription reconciliation;
- unknown/unmapped provider references.

Financial correction should preserve history.

---

## AI runtime operations

Opening the tenant Agent panel loads the signed-in operator's conversation history, checks answering readiness and resolves an optional configured Agent identity. It does not send a question to `/ai/ask`. Investigate initial-load failures at the browser-to-Next.js server action and its authorized database reads before diagnosing model-provider failures.

Bootstrap request and history-read failures appear as recoverable errors with Retry. Identity lookup failures keep history available through the built-in Operator Copilot fallback and display a retryable notice. Retries retain an already mounted conversation and composer draft; changing Organization clears the cached panel and ignores responses from the previous Organization. Sign-in, membership and service-access redirects remain enforced.

AI is provider-dependent and cost-sensitive.

Operational signals may include:

- model/provider assignment;
- request count;
- latency;
- provider error rate;
- refusals/invalid structured output;
- tool-call failure;
- usage/metering recording;
- cost attribution;
- fallback use where policy allows.

Do not silently change provider/model behavior during an outage unless fallback policy explicitly permits it.

An explicit runtime assignment should be respected.

---

## Connections

Connection operations should observe:

- authorization status;
- token expiry/revocation;
- provider/API errors;
- sync/import failures;
- last successful operation;
- selected-resource availability.

A Connection can remain present while becoming unusable.

“Connected” should not hide a revoked credential.

---

## Domain and web delivery

Public domain operations may depend on:

- DNS provider;
- Vercel/web delivery provider;
- hostname verification;
- TLS/certificate;
- published Studio state.

Operational readiness requires the entire chain.

Do not diagnose a hostname problem solely from the GildOps database row.

---

## Graceful degradation

When a non-core dependency fails, preserve unaffected product behavior.

Examples:

```text
map style unavailable
→ locations list still works

AI provider unavailable
→ non-AI operating surfaces continue

one Connector unavailable
→ other Connections/workspaces continue

optional analytics unavailable
→ operational writes continue
```

Do not make an optional enhancement a hard dependency for the whole app.

---

## Timeouts

External calls should have bounded wait time.

A hanging provider request must not hold a request/function indefinitely.

Timeout policy should reflect:

- expected provider latency;
- serverless execution limits;
- retry strategy;
- user experience.

Timeouts should surface as an operational category distinct from validation failure.

---

## Retries, backoff and jitter

Retry transient failures.

Do not retry permanent failures blindly.

Transient examples:

- provider 5xx;
- network timeout;
- rate limit with retry guidance.

Permanent examples:

- invalid credential;
- unauthorized operation;
- malformed request;
- unsupported resource.

Use backoff.

Use jitter where coordinated retries could amplify an outage.

Respect provider `Retry-After` or equivalent guidance.

---

## Circuit breaking and isolation

Introduce circuit breakers or workload isolation when measured failure shows repeated requests are making an outage materially worse.

Potential future isolation boundaries include:

- AI-intensive workloads;
- bulk imports;
- critical billing;
- communications.

Do not add distributed-systems machinery solely for architectural aesthetics.

Complexity must solve observed or credible operational risk.

---

## Rate limits

Know rate-limit behavior for dependencies that affect core workflows.

Operational response should distinguish:

```text
our abuse/rate limit
provider rate limit
commercial allowance
provider quota
```

These are different concepts.

---

## Capacity and scaling

Capacity planning should follow measured growth.

Track relevant consumption by Organization and platform total where possible.

Candidates include:

- database storage;
- file storage;
- serverless invocation;
- AI usage;
- telephony/message volume;
- email volume;
- provider resources;
- report/query load.

This information also feeds GildOps platform economics.

Do not assign tenant cost/limit policy directly from one provider's quota without the commercial model.

---

## Cost observability

Operational cost and customer-facing pricing are different.

Platform operations should be able to understand:

```text
provider usage
provider cost
platform infrastructure cost
tenant normalized usage
retail charge
margin
```

Missing provider cost/rate/FX remains unknown.

Never display unknown cost as zero.

---

## Credential operations

Credentials expire, rotate and get revoked.

Operational practice must support:

- identifying credential owner;
- last verification;
- rotation;
- safe replacement;
- disabling compromised credentials;
- post-rotation verification.

Do not wait until an outage to discover that no one knows where a credential lives.

Secret values remain outside documentation.

---

## Production access

Production access should be:

- least privilege;
- role-based where provider supports it;
- auditable;
- limited to people who need it.

Avoid permanent shared administrator credentials.

Sensitive access includes:

- Supabase Production;
- Vercel Production;
- live provider accounts;
- DNS/domain control;
- Platform provider credentials;
- billing configuration.

---

## Manual Production changes

Manual changes may be necessary.

When they occur:

1. record what changed;
2. record why;
3. verify the result;
4. reconcile the change into normal configuration/source/process if it should persist.

Avoid invisible configuration drift.

---

## Maintenance

Operational maintenance includes:

- dependency/security updates;
- credential rotation;
- provider API/version changes;
- database maintenance;
- backup/restore checks;
- stale resource cleanup;
- retired environment cleanup;
- domain/certificate checks;
- cost/capacity review.

Maintenance is planned work, not “only when something breaks.”

---

## Deprecation and cleanup

Retired infrastructure creates:

- cost;
- confusion;
- attack surface;
- stale credentials;
- accidental dependency.

When safe, remove unused:

- provider accounts;
- OAuth apps;
- webhook endpoints;
- credentials;
- environments;
- domains;
- database resources;
- Vercel projects/deployments that no longer serve a purpose.

Historical Git/database migration evidence remains; live operational resources do not need to.

---

## SLI and SLO

An SLI is a measured reliability property.

Examples:

```text
successful login rate
booking success rate
message send completion rate
automation completion within expected window
```

An SLO is the target for that indicator.

Do not create meaningless “99.9%” targets just because the terminology exists.

Define SLOs when:

- user expectations are clear;
- measurement exists;
- the service has enough operational maturity to act on the objective.

---

## SLA

An SLA is a contractual commitment.

It is not interchangeable with an internal SLO.

Do not publish contractual reliability promises based on an unmeasured aspirational target.

---

## Error budgets

Error budgets become useful when SLOs are real and measured.

They can inform tradeoffs between:

```text
reliability work
and
feature/release velocity
```

They are not required ceremony for an early system.

---

## Operational review

A periodic operational review should examine:

- incidents;
- recurring provider failures;
- slow/expensive queries;
- automation lag;
- capacity growth;
- credential age/readiness;
- failed imports/syncs;
- billing/webhook reconciliation;
- Production error trends;
- cost anomalies;
- stale infrastructure.

The review should produce concrete actions, not an observability dashboard that nobody operates.

---

## Operational verification after changes

After material runtime changes, verify:

### Application

- deployment responds;
- smoke passes;
- changed route/journey works.

### Database

- migration state correct;
- no abnormal database error spike;
- relevant query/function works.

### Provider

- callback/operation succeeds;
- verification state correct;
- no unexpected retry/error loop.

### Scheduler

- expected invocation occurs;
- due work processed;
- no duplicate side effects.

### Security

- no authorization/RLS regression;
- no secret leakage in logs/errors.

---

## Reliability anti-patterns

Do not:

- make optional provider health part of global readiness;
- retry every error;
- run unbounded provider retries;
- consider a scheduler healthy only because the cron endpoint returned 200;
- use logs containing secrets;
- rely on memory for incident timelines;
- make manual Production changes and leave them undocumented;
- assume a backup is usable without restore testing;
- publish arbitrary SLO/SLA numbers;
- conflate business metrics with service health;
- let one failing optional provider take down unrelated workspaces;
- operate with shared permanent admin credentials;
- treat unknown cost as zero;
- create infrastructure complexity without an operational problem it solves;
- call a deployment successful before post-deployment verification.

---

## Operational readiness checklist

For a new production capability:

- [ ] runtime owner is known
- [ ] dependencies are identified
- [ ] core vs optional dependency behavior is defined
- [ ] logs contain useful correlation
- [ ] secrets are excluded from telemetry
- [ ] meaningful failures are distinguishable
- [ ] retry/idempotency behavior is defined
- [ ] provider reconciliation exists where required
- [ ] deployment verification is defined
- [ ] rollback/rollforward path is understood
- [ ] capacity/cost signals exist when material
- [ ] at least one operator can diagnose the capability without reading the entire codebase

---

## Document boundaries

This document owns:

- runtime inventory;
- operational health concepts;
- logging/metrics/correlation;
- monitoring/alerting;
- incidents/postmortems/runbooks;
- backups/recovery;
- scheduler reliability;
- provider failure operation;
- capacity/cost observability;
- maintenance and Production operational practice.

It does not own:

- deployment procedure details;
- test taxonomy;
- local development;
- domain semantics;
- secret values;
- provider integration contracts.

Those belong to the respective canonical documents.
