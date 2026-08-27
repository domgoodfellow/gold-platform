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
  client we have mispriced or misunderstood.
- **Not a no-code builder.** Configuration is deep, but the platform has opinions. A
  business that wants an empty canvas wants a different product.
- **Not accounting software.** Job economics — revenue, labour, materials, travel, margin —
  are tracked because they drive operational decisions. The general ledger stays elsewhere.
- **Not a chatbot with a database.** AI operates the business through the same domain
  services a human uses, under the same permissions.

## The commercial model

Three products, each the previous one plus a layer. This is not only a price list — it is
the build order, and the two should not diverge.

| Tier | Price | What it is technically |
|---|---|---|
| Management System | $299–799/mo | The kernel plus operational modules |
| AI Management System | $799–2,000/mo | An AI layer over the domain tools |
| AI Workforce / Voice | $1,500–5,000+/mo | The realtime communications plane |

Pricing is **platform fee + modules + usage + implementation**, never primarily per seat.
A fifteen-person company replacing three systems is not buying fifteen accounts; charging
as though they were leaves most of the value uncaptured.

Implementation is a real line item, not a loss leader. The discovery-and-configuration step
is the product working as designed.

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
its second business.

See `constraints.md` for what that means in practice, and `roadmap.md` for what "done"
means at each stage.
