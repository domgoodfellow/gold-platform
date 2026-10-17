# Customer journeys

Status describes repository implementation, not hosted/provider acceptance. **Built** means the path exists; **partial** means a required connection or application step is absent; **missing** means no implementation. `web/` below means `apps/web/`; `api/` means `apps/api/`. `{org}` and `{customer}` are organization and Customer IDs.

## Sales-led onboarding

| Step / route | Owner | Status and evidence |
| --- | --- | --- |
| Prospect Customer: `/organizations/{org}/customers/{customer}` | CRM | **Built.** `web/app/organizations/[organizationId]/customers/[customerId]/page.tsx`. Discovery/configuration/proposal reads and tabs require the configured GildOps operating organization and live platform authority. |
| Discovery tab, same route | CRM discovery | **Built.** `web/features/crm/customers/discovery-snapshot-section.tsx`; `web/lib/domain/customers/discovery-snapshots.ts`. Durable operational answers. |
| Proposed configuration tab, same route | CRM sales composition / Catalogue | **Partial.** `web/lib/domain/customers/configuration-recommendation.ts`. Catalogue-based recommendations exist; these do not configure the future tenant. |
| Commercial proposal and invite, same route | Commercial proposals / proposal access | **Built.** `web/features/crm/customers/commercial-proposal-section.tsx`; `web/lib/domain/customers/proposal-invites.ts`. Versioned terms and an access link; creating a link is not email delivery. |
| Open `/proposal/{token}`, then review/accept at `/proposal` | Public proposal access / Commercial proposals | **Built.** `web/app/(public)/proposal/[token]/route.ts`; `web/app/(public)/proposal/actions.ts`. Separate proposal session; acceptance snapshots the version shown. |
| Staff handoff, selling Customer route | Platform provisioning / Commercial proposals | **Built.** `web/lib/domain/customers/proposal-handoff.ts` invokes `hand_off_accepted_proposal`: atomic, repeat-safe organization, owner Membership, Plan and recorded handoff. |
| `/organizations/{newOrg}/setup`, then `/setup/proposal` under that organization | Organization Setup / configuration | **Partial.** `web/app/organizations/[organizationId]/setup/page.tsx`; `setup/proposal/page.tsx`. Founding context is shown and may seed a draft; accepted configuration is not automatically applied. |

## Self-serve onboarding

| Step / route | Owner | Status and evidence |
| --- | --- | --- |
| `/sign-up` | Identity | **Built.** `web/app/(auth)/sign-up/actions.ts`; `web/lib/domain/identity/credentials.ts`. Account creation and conditional verification. |
| `/verify-email`, `/auth/callback` | Identity | **Built.** `web/app/(auth)/verify-email/actions.ts`; `web/app/auth/callback/route.ts`. Verify before entering the authenticated flow; deployment email delivery still needs provider evidence. |
| `/organizations`: create-business form | Tenancy | **Built.** `web/app/organizations/create-business-form.tsx`; `web/app/organizations/actions.ts`. Creates business and founding Membership with location/timezone/currency inputs; no sales proposal. |
| `/organizations/{org}/setup`, optional `/setup/proposal` | Organization Setup / configuration | **Partial.** `web/app/organizations/[organizationId]/setup/page.tsx`; `setup/actions.ts`. Manual setup and reviewed configuration draft/apply exist. Both acquisition paths reach Setup, but they have different founding/commercial inputs rather than one reconciled onboarding contract. |
| Calling infrastructure, no self-serve provisioning route | Platform provider operations | **Missing** as an onboarding step. `web/app/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/page.tsx` exposes staff operations; neither creation path provisions telephony. |

## Inbound call to a business

| Step / route | Owner | Status and evidence |
| --- | --- | --- |
| Number/account binding, staff organization administration route above | Platform provider operations | **Partial.** `web/lib/domain/providers/bindings.ts`. Manual platform setup; a number shown locally is not evidence of live carrier routing. |
| Carrier POST `/voice/inbound` → `/api/voice_inbound` | Communications ingress / provider adapter | **Built** for signed recording and busy rejection. `api/vercel.json`; `api/api/voice_inbound.py`. It records the inbound event when possible and returns `<Reject reason="busy"/>`. |
| Preview `/routing/preview-inbound` | Communications routing | **Partial.** `api/api/routing_preview_inbound.py`; `api/app/domains/communications/routing.py`. Human destination/fallback decisions exist, but this resolver is not invoked by the live inbound handler. |
| Human ringing, or message fallback, on live inbound ingress | Communications / telephony adapter | **Missing** at this ingress boundary; the handler still rejects. Resolver decisions alone do not prove call execution. |
| AI answers and transfers a call | AI capability / Communications | **Missing.** No AI target or adapter invocation in `api/app/domains/communications/routing.py`; integration design is proposed separately. |
| Call record `/organizations/{org}/calls/{callId}`; history on `/organizations/{org}/calls#call-history` | Communications | **Built.** `web/app/organizations/[organizationId]/calls/[callId]/page.tsx`; `web/features/communications/voice/call-history.tsx`. Recorded call status is distinct from answering readiness. |

## Gaps

- Telephony provisioning is manual; neither onboarding path provisions a carrier binding/number.
- Accepted configuration is recorded at handoff, not automatically applied to the new business.
- No AI answering; live inbound ingress also lacks execution of the routing resolver's human/message decisions.
- Self-serve and sales-led onboarding share Setup but do not reconcile their founding and commercial inputs through one onboarding contract.
