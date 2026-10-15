# CLAUDE.md

## Purpose

This file is the **operating contract for coding agents working in the GildOps repository**.

It tells an agent:

- how to approach a task;
- which documents are authoritative;
- where code belongs;
- what repository mutations require explicit permission;
- what must be verified before work is called complete;
- how to report results.

This file is intentionally operational.

It does not duplicate the product, domain, architecture, security or UI specifications.

Read the canonical document for the concern you are changing.

---

## First rule: understand the requested mode

Before using tools or changing files, classify the request.

### Read-only work

Examples:

- audit;
- review;
- inspect;
- analyze;
- compare;
- explain;
- inventory;
- plan;
- produce a work order;
- evaluate architecture;
- identify defects;
- return replacement document content.

For read-only work:

> **Do not create a branch, edit repository files, commit, push, open a pull request, deploy, migrate a database or change an external provider.**

Return findings or artifacts only.

An instruction to “audit and make a plan” is not permission to implement the plan.

---

### Repository mutation

Examples:

- implement;
- fix;
- refactor;
- add;
- remove;
- edit the repo;
- update the files;
- apply the change.

Repository mutation permits file edits required for the requested task.

It does **not** automatically permit:

- branch creation;
- commit;
- push;
- pull request;
- merge;
- deployment;
- remote database mutation;
- provider-console mutation.

---

### Git mutation

Create a branch, commit, push or pull request **only when explicitly requested**.

Do not infer permission from:

- “proceed”;
- “do the work”;
- “fix it”;
- “implement it”;
- a previous conversation where a PR was useful.

If branch/commit/PR work was not requested, leave the working tree with the requested changes and report them.

---

### Shared/external mutation

Commands or tools that change:

- hosted Supabase;
- Vercel;
- Stripe;
- Twilio;
- Resend;
- DNS;
- OAuth registrations;
- provider accounts;
- production secrets;
- live customer data;

require an explicit task that calls for that mutation.

Inspecting those systems is not permission to change them.

---

## Work method

Use this sequence.

```text
Request
↓
Inspect current state
↓
Identify canonical owner
↓
Check relevant docs
↓
Define smallest coherent change
↓
Implement only requested scope
↓
Verify the actual requirement
↓
Report evidence and remaining risk
```

Do not start by inventing a solution from memory.

---

## Inspect before changing

Before proposing or implementing a structural change:

1. inspect the relevant route/component/domain/database code;
2. identify existing shared patterns;
3. identify current callers;
4. inspect tests that enforce the boundary;
5. read the canonical documentation for the concern;
6. identify contradictions instead of silently working around them.

The repository may contain legacy comments and names.

Current canonical documentation wins over stale prose unless executable behavior proves the documentation itself is wrong.

If code and canonical documentation disagree materially, report the contradiction.

---

## Canonical documents

Read only what the task needs.

| Concern | Canonical document |
| --- | --- |
| Product identity, workspaces, ownership | `docs/product.md` |
| Canonical business concepts | `docs/domain-model.md` |
| Repository/runtime architecture | `docs/architecture.md` |
| UI, navigation, archetypes, responsive behavior | `docs/ui-system.md` |
| Identity, permissions, trust boundaries | `docs/security.md` |
| Persistence, migrations, money/time/history | `docs/data.md` |
| Providers, Connections, OAuth, webhooks, imports | `docs/integrations.md` |
| Public websites, domains, public sessions, SEO/legal publishing | `docs/public-web.md` |
| Test strategy and verification | `docs/testing.md` |
| Local setup | `docs/development.md` |
| Hosted release process | `docs/deployment.md` |
| Runtime operations/reliability | `docs/operations.md` |
| Current work sequence | `docs/roadmap.md` |
| Material decision history | `docs/decisions/README.md` and ADRs |
| Shipped dated changes | `CHANGELOG.md` |

`README.md` is orientation.

It does not override a canonical concern document.

---

## Current product vocabulary

Human-facing name:

```text
GildOps
```

Canonical operator workspaces:

```text
CRM
Communications
Marketing
Support
Finance
AI
Automations
Field
Studio
```

Cross-cutting/shared surfaces such as:

```text
Home
Library
Insights
Settings
```

are not automatically workspaces.

Platform Administration is a separate privileged scope.

Do not reintroduce retired workspace language such as a canonical Sales, Service or Insights workspace.

Legacy routes or technical identifiers may remain for compatibility.

---

## Scope model

Keep these separate:

```text
Person
Organization
Platform Administration
```

An Organization is the tenant boundary.

GildOps' own business uses an ordinary Organization.

Platform authority is explicit and separate from Membership.

Never infer Platform authority from:

- membership in GildOps;
- role name;
- route access;
- UI visibility.

---

## Domain ownership

A business fact has one canonical owner.

Other domains may display or invoke it.

They do not copy ownership.

Examples:

```text
CRM
→ relationship

Communications
→ conversation/channel

Support
→ problem/request resolution

Field/Work
→ work to be performed

Scheduling
→ when resources can commit

Finance
→ customer-to-organization money

Studio
→ authored/published customer experiences

Marketing
→ audience/acquisition/campaign intent

Automations
→ durable orchestration

AI
→ reasoning/tool use, not business truth
```

Invocation never transfers ownership.

---

## Commercial vs authorization

Always separate:

```text
Organization entitlement
```

from:

```text
Actor permission
```

A capability may require both.

Do not treat:

- a hidden navigation item;
- a Role capability;
- a Plan;
- a Feature flag;

as interchangeable.

---

## Finance boundary

Never merge:

### Tenant Finance

```text
customer
↓
organization
```

with:

### Platform commercial control

```text
organization
↓
GildOps
↓
provider
```

GildOps provider costs and margin do not belong in tenant Finance.

---

## Provider vs Connection

Do not confuse:

```text
Provider
Provider Account
Provider Binding
Provider Resource
```

with:

```text
Connector
Connection
Connection Credential
Integration Resource
```

Provider infrastructure is operated by GildOps.

Connections are Organization-owned relationships with external systems.

A file upload/import format is neither.

---

## Repository architecture

```text
apps/
  web/
    app/
    components/
    features/
    lib/
      application/
      domain/
      adapters/

  api/
    api/
    app/
      core/
      domains/
      providers/
      connectors/
      ai/
      ...

packages/
  config/
  schemas/
  types/
  ui/

supabase/
  migrations/
  snippets/

infrastructure/
docs/
scripts/
```

Do not create a new top-level architectural layer without a demonstrated responsibility and a decision that justifies it.

---

## Web layer rules

### `apps/web/app`

Owns:

- routes;
- route parameters;
- route-level context;
- top-level loading/composition;
- redirects/not-found behavior.

Do not put substantial reusable domain logic in route files.

---

### `apps/web/features`

Owns recognizable product interaction.

Examples:

- feature forms;
- feature-specific tables;
- drawers;
- task interaction;
- client state.

Do not recreate generic UI primitives here.

---

### `apps/web/components`

Owns shared GildOps UI grammar.

Examples:

- page containers;
- headers;
- navigation;
- panels;
- shared patterns;
- surfaces.

Before creating another shared-looking route-local component, inspect this directory.

---

### `apps/web/lib/application`

Owns use-case/read-model composition.

It may combine several domains for a screen.

It does not become another business-rule layer.

---

### `apps/web/lib/domain`

Owns business language and operations.

Business rules belong here or in authoritative database constraints/functions according to the invariant.

React components do not decide domain policy.

---

### `apps/web/lib/adapters`

Owns provider implementations.

Domain code depends on capability contracts.

Do not import vendor SDKs directly into domain code.

---

## API rules

`apps/api` is a deployed Python runtime for:

- provider ingress;
- provider operations;
- scheduled work;
- integration/OAuth operations;
- AI/model operations;
- narrow cross-runtime domain commands.

It is not a second independent domain model.

The API and web runtimes must preserve the same canonical business semantics.

Public route rewrites are defined in:

```text
apps/api/vercel.json
```

Local API routing derives from that file.

Do not create another route registry.

---

## UI rules

Read `docs/ui-system.md` before changing a screen.

Key rules:

- choose the surface archetype first;
- use shared page geometry;
- use shared page identity;
- use semantic section spacing;
- do not default every page to title + explanatory sentence;
- do not use Card as a page architecture;
- do not create route-local width systems;
- do not duplicate Settings ownership;
- navigation and actions are different;
- organization workspace rows enter their canonical Home;
- entered workspaces use contextual sidebar destinations; CRM Configuration groups its routed children in a navigable disclosure;
- Overview links to the workspace Home;
- responsive design is intentional re-composition.

### Content-priority gate

Before building or changing a user-facing surface, apply the content-priority, progressive-disclosure, colour, typography, ethical-interaction and accessibility rules in `docs/ui-system.md`.

- Do not render every description, status or metadata field merely because the data provides it.
- Default to a concise label, the operative state or control, and a direct action.
- Show helper text only for instructions or blockers the current task needs. Put the rest behind a disclosure the person chooses to open.
- Never leave critical information only in a toast, a hover-only tooltip or a colour.
- Keep entitlement, permission, activation and readiness distinct without repeating all of them on every row.
- Use the existing semantic tokens and shared components. Tenant accent never recolours status.
- Do not use dark patterns.

For any user-visible change, inspect the actual rendered result: desktop, tablet and phone, keyboard and touch use of any new interaction, and the relevant states (empty, error, locked, permission). Passing tests and a successful build are not visual verification.

---

## Settings ownership

Settings begins with exactly:

```text
Organization
Account
Access
Connections
Plan & usage
```

Do not create peer duplication.

Examples:

```text
Members / Invitations / Roles
→ Access

Profile / Security & sign-in
→ Account

External-system relationships
→ Connections

Subscription / entitlements / usage
→ Plan & usage
```

Organization Settings owns business configuration, not personal identity or team access.

---

## Data rules

Read `docs/data.md` before schema work.

Non-negotiable defaults:

- tenant-owned rows have explicit Organization scope;
- cross-tenant relationships are structurally prevented;
- money uses integer minor units plus currency;
- absolute timestamps use timezone-aware storage;
- unknown is not zero;
- historical committed meaning is snapshotted/effective-dated/appended as appropriate;
- applied migrations are immutable;
- generated database types are generated, not hand-edited.

Do not encode a database invariant only in UI code.

---

## Database migration rules

Schema changes go through:

```text
supabase/migrations/
```

Never rewrite applied migration history.

Standalone diagnostics/maintenance SQL belongs in:

```text
supabase/snippets/
```

Typical schema workflow:

```bash
pnpm db:reset
pnpm db:types
pnpm test:local
```

plus focused/broader verification according to risk.

Remote commands are shared-state mutations.

Do not run them without explicit scope.

---

## Security rules

Read `docs/security.md` before auth, role, RLS, public or provider work.

Key principles:

- browser state is not enforcement;
- UI visibility is not authorization;
- RLS/server/domain boundaries enforce protected operations;
- external input is untrusted;
- public identities are not tenant Memberships;
- machine identities are narrow;
- secrets are write/use, not ordinary readback;
- provider webhook authenticity is verified before mutation;
- AI output is untrusted input.

Security changes require negative tests.

---

## AI rules

AI may:

- read authorized context;
- answer;
- draft;
- use approved tools;
- propose actions.

AI may not:

- become a parallel database;
- bypass RLS/authorization;
- invent a direct write path;
- treat retrieved external content as authority;
- mutate consequential state outside canonical domain operations.

Where approval is required:

```text
propose
↓
record intended action
↓
authorized approval
↓
canonical operation
```

---

## Automation rules

Automations owns durable:

```text
Trigger
Conditions
Actions
Run history
```

Automation actions call canonical domain operations.

Do not duplicate the target domain's rules inside the automation engine.

AI inside an automation remains a component of the automation, not its owner.

---

## Code comments

Default to **fewer comments**.

A comment earns its place when it explains something the code cannot safely communicate by structure/naming alone.

Good reasons:

- security-sensitive why;
- provider/protocol quirk;
- database behavior that is counterintuitive;
- compatibility constraint;
- race/concurrency reason;
- deliberate refusal of an apparently simpler approach.

Bad comments:

- restating the next line of code;
- implementation diary;
- milestone history;
- stale decision numbers;
- references to removed documents;
- paragraph-length architecture duplication;
- obvious folder descriptions;
- “temporary” with no actual lifecycle owner.

Prefer:

```text
clear names
types
tests
canonical documentation
ADR
```

over comments.

When touching a file, remove obviously stale comments in the edited area if doing so is safe and directly related.

Do not turn an unrelated task into a repository-wide comment cleanup.

---

## Naming

Use GildOps in new human-facing prose.

Legacy technical names currently include:

```text
@gold/*
gold_*
Gold*
gold-platform
```

Do not perform broad branding search-and-replace.

A technical namespace migration must be bounded and update all callers/tooling atomically.

Never rewrite historical migrations merely to rename GOLD to GildOps.

---

## Dependency discipline

Use the simplest structure that solves a real problem.

Do not create:

- speculative shared packages;
- abstractions with no real caller;
- generic engines because several concepts sound similar;
- a second canonical registry;
- a second availability calculation;
- a second pricing calculation;
- a second customer model;
- a second communication lifecycle.

Reuse existing ownership first.

---

## Tests

The test source of truth is:

```text
test-manifest.json
```

Test launcher:

```text
scripts/test.mjs
```

Every test file belongs to one category.

Read `docs/testing.md` before inventing a new test tier.

---

## Main commands

From repository root:

```bash
pnpm check
```

is the broad repository gate.

Useful focused commands:

```bash
pnpm check:fast
pnpm check:api

pnpm test:unit
pnpm test:component
pnpm test:architecture
pnpm test:architecture:db
pnpm test:db
pnpm test:contract
pnpm test:api
pnpm test:local
pnpm test:e2e
pnpm test:smoke
pnpm test:visual
pnpm test:provider
```

Development:

```bash
pnpm db:start
pnpm db:reset
pnpm db:types
pnpm demo
pnpm demo:fresh
pnpm --filter @gold/web dev
python apps/api/dev.py
```

See `docs/development.md` for prerequisites.

---

## Verification rules

Never say:

> verified

without saying what evidence exists.

A completion report distinguishes:

### Implemented

What changed.

### Verified

Commands/runtime behavior actually executed.

### Not verified

Anything not exercised.

### Remaining risk

Known relevant limitations.

---

## UI verification

Passing TypeScript/tests is not enough for user-visible work.

Inspect the rendered application.

Check relevant:

- desktop;
- tablet/compact;
- phone;
- navigation;
- interaction;
- focus;
- empty;
- error;
- permission/entitlement;
- provider-unconfigured state.

Use Playwright when appropriate.

Do not claim visual correctness from source scans.

---

## Database/security verification

If the requirement depends on:

- RLS;
- grants;
- constraints;
- PostgreSQL transactions;
- cross-tenant isolation;

test it against real local PostgreSQL/Supabase.

Do not mock the thing you are trying to prove.

---

## Provider verification

Distinguish:

```text
offline provider contract
provider sandbox
production operation
```

A mocked/offline adapter test does not prove a live provider account is configured.

A provider tier with zero tests proves no provider.

State this accurately.

---

## Git safety

Do not create repository history unless asked.

### Never assume permission for:

```text
git checkout -b
git switch -c
git commit
git push
gh pr create
merge
rebase shared branch
force push
```

If the user asks for implementation but not Git history:

- edit the requested files;
- run verification;
- report the diff/worktree state;
- stop.

If the user asks for a branch/commit/PR, then perform exactly that requested Git scope.

Do not bundle unrelated existing changes into the commit.

---

## Remote database safety

Commands such as:

```bash
pnpm db:push
pnpm db:query:remote
pnpm snippet:*:remote
```

touch shared hosted state.

Do not run them as verification unless the user explicitly requested remote deployment/database work.

Local database verification is the default.

---

## Provider safety

Do not create/delete/modify:

- Twilio numbers/subaccounts;
- Stripe products/prices/webhooks;
- Resend domains/keys;
- OAuth registrations;
- DNS records;
- Vercel production settings;

merely because implementation code exists for them.

Provider configuration is a separate requested operation.

---

## Work orders and plans

When asked for a work order rather than implementation:

return:

1. objective;
2. current-state assumptions/findings;
3. scope;
4. explicit non-scope;
5. architecture/ownership constraints;
6. files/areas to inspect;
7. implementation sequence;
8. tests/verification;
9. definition of done.

Do not implement the work order unless also asked to implement.

---

## Audits

When asked to audit:

- inspect;
- measure;
- cite concrete code/routes/components;
- distinguish fact from recommendation;
- identify severity;
- produce remediation order.

Do not “helpfully” start refactoring during the audit.

The audit is the deliverable.

---

## Scope control

Do the smallest coherent change that satisfies the requested outcome.

A coherent slice may cross:

```text
schema
domain
application
route
UI
tests
```

when the behavior requires all of them.

Do not split one invariant across several half-working commits merely to keep each file change tiny.

At the same time, do not absorb unrelated cleanup because it is nearby.

---

## Contradictions

If you discover:

```text
documentation says A
code says B
tests enforce B
```

do not silently choose.

Determine whether:

- code is stale;
- documentation is stale;
- test is stale;
- a migration is incomplete.

Report the contradiction.

If the requested implementation requires changing the architecture, update the canonical document/ADR as part of that architecture change.

---

## Roadmap discipline

`docs/roadmap.md` owns current sequencing.

Do not turn it into a task checklist.

Do not add completed implementation diaries.

A named customer may provide evidence for platform work.

It does not justify a customer-specific architecture fork.

NextFund is not assumed to already be a tenant.

---

## Documentation discipline

Update existing canonical documents when the product truth changes. An instruction to update
documentation does not authorize new documentation files or directories.

Do not create documentation directories without an explicit user request. Do not create standalone
verification reports, completion reports, implementation diaries, audit reports or work logs unless
the user explicitly requests a repository file. Return requested completion reports and test results
in chat. Keep generated test output in existing ignored artifact locations.

Architecture decisions may use the established `docs/decisions/` ADR convention. That does not
authorize another documentation category or directory.

---

## Changelog discipline

`CHANGELOG.md` records meaningful shipped changes by actual date.

Do not write undated multi-page implementation diaries.

Do not copy commit history verbatim.

A good changelog entry answers:

```text
What changed for the product/operator?
What important boundary changed?
What compatibility or known limitation matters?
```

Exact file history belongs in Git.

---

## Definition of complete

Work is complete only when:

1. the requested outcome is implemented;
2. ownership follows canonical architecture;
3. no parallel source of truth was introduced;
4. security/data invariants are preserved;
5. tests match the actual risk;
6. user-visible changes were rendered where applicable;
7. documentation is updated only where the current truth changed;
8. verification evidence is reported;
9. no unrequested Git/deployment/provider mutation was performed.

Prefer an honest partial result over a false claim of completion.
