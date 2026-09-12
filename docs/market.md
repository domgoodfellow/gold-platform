# Market

> Who buys this, why they switch, and what they are charged for.

The demand-side counterpart to `vision.md`. That document says what the product is; this one
says who wants it and what they pay for. Neither can be derived from the other, and until this
file existed the repository had eight thousand lines about the machine and none about the buyer.

**This document is held to the same evidence bar as the code.** `constraints.md` refuses to
build an engine before two independent pieces of evidence want it. Most of the claims below do
not clear that bar yet, and the last section says which ones and what would settle them.

It is deliberately the shortest document in `docs/`. Reasoning that grows past a page belongs
in a decision record.

---

## Who we sell to

**An operations business running on a spreadsheet, a phone and a notebook.** Nothing digital in
place, or something so thin it does not count — a booking inbox, a shared calendar, a WhatsApp
group.

The competitor is nothing, and that is the whole wedge:

- No incumbent contract to break.
- No data migration.
- No retraining away from a system somebody already knows.
- No feature-parity checklist. Anything beats a notebook.

**Three reasons they buy, in the order they say them:**

1. *"We need to be digital."* Nothing in place. This is the first sale.
2. *"We want AI and automation."* A system exists and feels dated. This is the second sale, to
   the same customer, and it is the one with margin in it.
3. *"We need a website and branding."* Later, same customer, third sale.

That ordering is the upsell path, which is why one customer is worth more than one
implementation fee.

**Who we do not sell to yet.** A business already running ServiceTitan, Jobber, Simpro or
Housecall. Displacement is phase two — see the last section for what it needs.

---

## What we sell

**Configured deployments.** The platform is the delivery mechanism; the invoice is for a
working operation.

| Line | What it is | Billed |
|---|---|---|
| Implementation | Discovery, configuration, data entry, training, launch | Per engagement, up front |
| Platform and modules | Recurring, per tenant, by what is switched on | Monthly from launch |

`vision.md`'s three tiers describe layers of *capability*. This table is the *money*, and the
two are different axes: a tenant on the base tier with five modules can pay more than one on
the AI tier with two. Per-seat is not the primary lever, per `vision.md`; the dialer (D5) is
the exception.

Prices are not in this file, or any file in `docs/` — D8.

---

## Why a platform rather than a fork per customer

The agency model has a failure mode with a name: every customer becomes a fork, and by the
fifth you are maintaining five codebases and selling none of them.

The platform is what makes the model scale. **The margin on implementation #10 differs from
implementation #1 only if #10 is configuration rather than code.** That is why
`configureBusiness` has no branch in it — the unit economics of this business, written as a
function.

---

## The demo

`tire-app-template`: single-tenant, in production on Vercel and Supabase — marketing site,
booking and payment, admin dashboard, integrations. Thirty tables, zero tenancy columns. One
business, hand-built.

**The demo is the pair, not either half.**

- Built once as a bespoke application: months.
- Rebuilt inside GOLD as a `BusinessShape` through `configureBusiness`: an afternoon.

The bespoke one shows a product. The configured one shows a platform. Side by side they show
the business model, which is the thing actually being sold.

Its second use is as **the first real entry in the configuration library**. M3's test configures
two invented businesses; this is a real one with a production twin to check the result against.

---

## What this implies for the roadmap

`roadmap.md` was sequenced for a self-serve engine, against a business model that had never
been written down. It owns sequence and now carries the order under *Order of work*; this table
is the demand-side reason for it, not a second copy of it. Where the two disagree, the roadmap
is the one to change.

| Milestone | Change | Why |
|---|---|---|
| M5 — the platform side | **Unchanged, first** | The factory floor. Every signed customer walks through provisioning. |
| AI onboarding (M8) | **Moves up** | The only build with two beneficiaries: the tenant's self-serve door, and our implementation margin. |
| Tenant marketing and branding (D20) | **Moves up** | A named revenue line and the third sale to the same customer. `organization_profiles` is the seed; it has no milestone number yet. |
| M6 workflows, M7 reporting | Unchanged | Real products; neither is in the pitch. |
| M9 — dialer | **Unchanged, second vertical** | D5's reasoning holds. GOLD is a user of it too — outbound to un-digitized businesses is vertical two, and GOLD's own Organization Context switches the module on like anyone else, no exemption (D42, D45). The trigger to build is call volume, not audience: thirty calls need a phone and a list. |
| M10 — desktop | **Out of the near path** | No customer has asked. |

**GOLD, dogfooding its own Organization Context (D42, D45),** runs alongside all of it and costs
nothing: an ordinary organization with ordinary memberships, distinct from platform authority —
checked live (`app.is_platform_staff()`), never a Postgres role a session had to wear instead of
its own — that D28 keeps out of every tenant. Our own implementation pipeline is customers, work
items and scheduling — the exact path a tenant uses. The risk to watch: a field our own pipeline
wants is *one* caller, and `constraints.md` is right to refuse it.

---

## What blocks the first customer

| Blocker | State |
|---|---|
| ~~`setTypeBookable` has no route~~ | **Closed.** Publishing is a section on the Work screen, under the kind of work being published. The public flow is demonstrable by hand. |
| GOLD is not deployed | Tracked on GitHub, but nowhere live: no `.vercel` directory, no hosting config, and `vercel.json` exists only under `apps/api`. |
| Operator provisioning | M5, next. |
| Tenant marketing surface | Deferred by D20; `tire-app-template` holds the pattern in `site_content`. |
| Taking money from a tenant's customers | D27 decided, no route built. |
| Billing the tenant | Implementation and platform fees are invoiced. **One metered cost is not: reaching people.** Calls, texts and email are paid for with credit bought in advance — a thing purchased, not a bill sent, so there is no arrears and no credit risk (D40). |

---

## What is evidence and what is assumption

| Claim | Basis | Status |
|---|---|---|
| Field-service operations generalise across business shapes | Three prior repositories, one in production | **Evidence** |
| `tire-app-template`'s shape is a real business's shape | In production | **Evidence** |
| A voice plane can be built and run | `nextfund-portal` | **Evidence** |
| Businesses with no system will pay for a configured deployment | — | **Assumption** |
| The AI and automation upsell lands as a second sale | — | **Assumption** |
| Implementation compresses enough to hold margin at volume | — | **Assumption** |
| Marketing and branding is a third sale to the same customer | — | **Assumption** |

Four blanks this document cannot fill from inside the repository:

- **The first customer, by name.**
- **What they pay today, and to whom.**
- **The geography and the trade.**
- **The price points**, which D8 keeps out of `docs/` in any case.

**Every row marked *Assumption* is answered by a sales call, not by a commit.** The first three
calls are the instrument. Until they happen, this document is a hypothesis with a table of
contents, and it should be revised or deleted on what they return.

---

## What phase two needs

Displacing an incumbent requires three things this platform does not have and should not build
speculatively: import from the formats incumbents export, parity on the two or three features
that actually hold a customer, and a reason to move stronger than *ours is nicer*.

Deliberately not scoped. It is named here so that "we will go after them later" is a recorded
decision rather than an assumption nobody wrote down.
