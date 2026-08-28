# Vision

> One engine. Many businesses. Configuration, not forks.

## What this is

A **multi-tenant business operating system**. One platform that becomes a machinery
maintenance system, a field-service dispatcher, a booking business, or a sales floor —
through configuration and modules, not a new codebase each time.

The distinction decides where logic lives. If this were four applications sharing a
component library, each would own its own notion of a customer, a schedule, and a job. It
is one engine, so `Customer`, `Work Item`, `Schedule`, and `Document` are defined once, in
the kernel, and every module consumes them.

When a business says *"we do things differently,"* the first question is never
*"what do we rebuild?"* It is:

> Which entity, workflow, rule, module, or integration represents that difference?

If the answer is configuration, configure it. If it is a reusable capability, it becomes a
module. Only genuinely unique behaviour becomes custom code.

## Who it serves

Small and mid-sized operations businesses where work is scheduled, assigned, performed,
and billed — and where the owner currently holds the process in their head, a spreadsheet,
and a phone.

Three shapes are in scope, and they are already understood from prior work:

- **Field service** — mobile technicians, travel-constrained scheduling, per-visit pricing,
  and work that external conditions can invalidate after it is booked.
- **Asset maintenance** — customer-owned machines, recurring plans, parts consumption.
- **Sales floors** — lead lists, dialers, call outcomes, pipeline.

E-commerce operations and property management are plausible later. They are not targets —
see `constraints.md` D12.

## What it refuses to be

- **Not a per-client app studio.** A client whose needs require forking the codebase is a
  client we have mispriced or misunderstood. Partial adoption is not a fork: a tenant may
  enable one module, keep their own system of record for the rest, and run identical code —
  see `constraints.md` D21.
- **Not an empty canvas.** Configuration goes as deep as no-code — a business shape is stood
  up with no migration and no deploy, and that is M3's acceptance test rather than a
  concession. What is not negotiable is the primitives: `Customer`, `Work Item`, `Resource`,
  `Event`. A business that wants to define its own entities wants a different product.
- **Not accounting software.** Job economics — revenue, labour, materials, travel, margin —
  are tracked because they drive operational decisions. The general ledger stays elsewhere.
- **Not a chatbot with a database.** AI operates the business through the same domain
  services a human uses, under the same permissions.

## The commercial model

Three products, each the previous one plus a layer:

| Tier | What it is technically |
|---|---|
| Management System | The kernel plus operational modules |
| AI Management System | An AI layer over the domain tools |
| AI Workforce / Voice | The realtime communications plane |

**The prices are deliberately not here.** They are the least durable claim this platform
makes — the first three sales calls will move them — and a number written in `docs/` carries
the same apparent authority as an invariant, which is precisely the authority it does not
have. The layering is architecture and belongs here. The numbers belong wherever numbers can
change without falsifying a document, and that is not this directory (D8).

**Nor does this file own the build order.** The two currently coincide — kernel, then AI,
then voice — and an earlier draft welded them with a rule that they must not diverge. That
rule lets a price list decide what gets built. `roadmap.md` owns sequence; a tier is a bundle
of capability, not a phase, and the two are free to come apart.

Pricing is **platform fee + modules + usage + implementation + deployment tier**. Per seat is
not the primary lever: a fifteen-person company replacing three systems is not buying fifteen
accounts, and charging as though they were leaves most of the value uncaptured. That is a
default and not a rule — the dialer is a genuinely per-seat market, and `constraints.md` D5
makes it vertical two.

Implementation is a real line item, not a loss leader. The discovery-and-configuration step
is the product working as designed. So is partial adoption: one module at a real price is a
tenant, not a discount (D21).

### Deployment tiers

The same code serves all three. This is an architectural commitment, not a sales promise —
see `constraints.md` D4.

- **Standard** — shared multi-tenant infrastructure.
- **Private** — dedicated database for one tenant.
- **Enterprise** — customer's own cloud.

## Surfaces

Every one of these is a *caller*. None of them owns a business rule.

This is the architecture, not the build order. Only the admin surface exists, and booking,
the customer portal and marketing are deliberately later — see `constraints.md` D20 for what
each is waiting on, which in every case is an invariant or an authorization model rather than
the screens themselves.

```text
   PUBLIC / BOOKING ────►┌──────────────────┐
                         │                  │
   ADMIN ───────────────►│  BUSINESS DOMAIN │◄──── INTEGRATIONS
   (operator, staff)     │                  │      Twilio · Stripe · Google · Maps
                         │                  │
   CUSTOMER PORTAL ─────►│                  │
                         └────────┬─────────┘
   AI / AGENTS ─────────►         │
   (domain tools only)   ┌────────▼─────────┐
                         │  Postgres / RLS  │
   DESKTOP (Electron) ──►└──────────────────┘
```

## Why this attempt is different

Three prior attempts exist, and each proved something worth keeping:

- **`tire-app-template`** proved the method — a domain layer with stated invariants, each
  naming the code or database constraint that enforces it. Six documents, one real business.
- **`saas-agent-platform`** proved the machinery — tenants, memberships, capabilities, RLS,
  usage metering, provider adapters. Fifty-three documents, no tenants.
- **`nextfund-portal`** proved the voice stack — Twilio routing, recording, transcription,
  RBAC, in production.

The failure mode is visible in the middle one: documentation and abstraction written *ahead*
of evidence, which then governed work that never arrived. This repo starts with four
documents and a hard budget: a function waits for its second caller, and a module waits for
its second piece of evidence — of which the three repos above are the first, since a system
that shipped is exactly the thing a hypothesis is not.

See `constraints.md` for what that means in practice, and `roadmap.md` for what "done"
means at each stage.
