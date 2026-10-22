# Customer journeys

Status describes repository implementation, not hosted/provider acceptance. **Built** means the path exists; **partial** means a required connection or application step is absent; **missing** means no implementation. `web/` below means `apps/web/`; `api/` means `apps/api/`. `{org}` and `{customer}` are organization and Customer IDs.

## CRM relationship intake

CRM Dashboard is `/crm`. Contacts at `/crm/contacts` is one directory of people and companies (All, People, Companies, optional grouping by company); new contacts must be a Person or a Company, and existing records stay Unspecified until someone classifies them. Lifecycle and temperature are independent of type. Contact detail is `/crm/contacts/{contact}` and shows company affiliations or associated people. Pipeline at `/crm/pipeline` operates opportunities; opportunity detail is `/crm/opportunities/{opportunity}`. Tasks (`/crm/tasks`) and relationship stages (`/crm/contacts/stages`) are contextual, not sidebar destinations. Old `/sales`, `/customers`, `/opportunities` and `/follow-ups` links redirect temporarily (removal criteria in `docs/data.md`).

Contacts Import and Library Sources/file selections enter the same source, mapping, duplicate review, confirmation and report path at `/library/imports/new`. Worksheet mappings can retain one-way association; source Sync now refreshes the existing Library snapshot and opens reviewed CRM updates. Automatic CRM scheduling is not enabled. Removed source rows preserve the contact; conflicting local edits appear as failed import rows requiring reconciliation. Live Google/Microsoft authorization and provider access remain separate acceptance evidence.

## Sales-led onboarding

| Step / route | Owner | Status and evidence |
| --- | --- | --- |
| Prospect contact: `/organizations/{org}/crm/contacts/{customer}` | CRM | **Built.** `web/app/organizations/[organizationId]/crm/contacts/[contactId]/page.tsx`. Discovery/configuration/proposal reads and tabs require the configured GildOps operating organization and live platform authority. |
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
| Calling infrastructure, no self-serve provisioning route | Platform provider operations | **Missing** as an onboarding step. `web/app/platform/organizations/[targetOrganizationId]/page.tsx` exposes staff operations; neither creation path provisions telephony. |

## Inbound call to a business

| Step / route | Owner | Status and evidence |
| --- | --- | --- |
| Number/account binding, staff organization administration route above | Platform provider operations | **Partial.** `web/lib/domain/providers/bindings.ts`. Manual platform setup; a number shown locally is not evidence of live carrier routing. |
| Carrier POST `/voice/inbound` ? `/api/voice_inbound` | Communications ingress / provider adapter | **Built.** Signed account-bound ingress records one ringing call, invokes the same resolver as preview and executes bounded human/external-number routing. `api/app/services/communications/inbound.py`; `api/app/domains/communications/routing.py`. Requires deployed callbacks and matching carrier account configuration; no live carrier acceptance yet. |
| Browser receives a human call | Communications telephone runtime | **Built.** The persistent Dialer offers ?Receive calls in this browser?; it registers the existing membership identity. Same-business navigation retains the device. Incoming direct calls expose mute/end, not conference supervision. |
| Unanswered routing | Communications | **Built.** The configured human/number fallback runs once, or the business?s message is spoken before ending. Message fallback does not collect voicemail. Carrier `/voice/status` remains required for terminal status/actual duration. |
| AI answers and requests human transfer | AI runtime / Communications | **Built adapter; provider unverified.** Business calling configuration references a published deployment and duration/budget limits. Platform assigns the voice runtime/account. Signed session events record actual usage once; transfer can reach only the route?s configured human fallback. `api/app/services/communications/voice_agent.py`; `api/app/providers/voice_agent/sessions.py`. Platform AI Runtime exposes recent admitted session state and unknown usage without credentials or stream URLs. External voice-agent implementation and sandbox acceptance remain separate. |
| Call record `/organizations/{org}/calls/{callId}`; history on `/organizations/{org}/calls#call-history` | Communications | **Built.** `web/app/organizations/[organizationId]/calls/[callId]/page.tsx`; `web/features/communications/voice/call-history.tsx`. Recorded call status is distinct from answering readiness. |

## Business configuration

Both acquisition paths reach the same versioned business profile editor in Setup and Organization General Settings. It controls authored vocabulary, labels and the ordered workspace page labels. Missing configuration keeps neutral defaults without asserting that setup was completed. Permissions and entitlements always filter the chosen destinations. `/platform` has its own guarded shell; GildOps operating-organization Membership and exact live platform permissions remain required. Old organization Platform URLs render the organization not-found page.

## Work creation

Work Home, Work Items and Schedule open `/organizations/{org}/work/new` through the same action. The existing Work creation form, server action and database tenant/permission checks own the operation. `?type=` selects a type; `/work?create=1&type=...` redirects to the creation page. Missing types or starting stages show prerequisites, permission-filtered configuration and a return to creation. Ready types expose customer, location, resource, optional asset and custom-field inputs. Errors retain the draft; success and Cancel return to Work Items. Dirty drafts guard links, type switches and browser unload through the shared unsaved-changes hook.

## Gaps

- Telephony provisioning is manual; neither onboarding path provisions a carrier binding/number.
- Accepted configuration is recorded at handoff, not automatically applied to the new business.
- Hosted routing, browser receiving, external voice sessions and carrier transfers still require deployed configuration and real provider acceptance. Local tests do not establish live readiness.
- Self-serve and sales-led onboarding share Setup but do not reconcile their founding and commercial inputs through one onboarding contract.
