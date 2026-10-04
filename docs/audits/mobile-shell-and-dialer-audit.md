# Mobile shell, navigation and dialer: current-state audit

> **Scope.** An audit only. It describes what the repository contains at the baseline below so the
> next work orders can be mechanical. It changes no behavior, and it does not edit the documents,
> tests or comments it names as stale. Nothing here was opened in a browser, and no live call was
> placed. Every statement about behavior is read from source; where a statement is an inference
> from source that has not been reproduced, it says so.

## 1. Baseline

| | |
|---|---|
| Branch | `main` |
| HEAD | `8bc748d610d7458e50dfc37561f058a0d1e5f327` (the same commit the work order inspected) |
| Working tree at the start | Clean. `git status --short` printed nothing. |
| Date of inspection | 2026-10-04 |

---

## 2. Current responsive shell map

```text
app/organizations/[organizationId]/layout.tsx          OrganizationLayout
  TelephoneDeviceProvider                              features/communications/voice/telephone-device.tsx
    OrganizationShell                                  features/shell/organization-shell.tsx
      WorkspaceShell                                   components/layout/workspace-shell.tsx
        WorkspaceRailProvider                          components/panels/workspace-right-rail.tsx
          WorkspaceCrumbsProvider                      components/navigation/workspace-crumbs.tsx
            WorkspaceRightRail  (main = AppShell)      components/panels/workspace-right-rail.tsx
              AppShell                                 components/layout/app-shell.tsx
                SidebarProvider                        packages/ui/src/components/sidebar.tsx
                ├─ Sidebar (OrgSidebar / LockedOrgSidebar)   app/organizations/[organizationId]/org-shell.tsx
                │     desktop and tablet: persistent column, icon rail when collapsed
                │     phone: the primitive's own off-canvas Sheet, mounted closed, no trigger reaches it
                ├─ SidebarInset
                │     ├─ WorkspaceHeader             components/headers/workspace-header.tsx
                │     ├─ page children (PAGE_PADDING; adds pb-24 below md when a bottom bar exists)
                │     └─ PagePanel                   components/panels/workspace-right-rail.tsx
                └─ bottomBar = OrgNavBar             org-shell.tsx (phone only: md:hidden)
            AgentPanel                                 components/panels/workspace-right-rail.tsx
            agent = TenantAgentRail                    features/agent/tenant-agent-rail.tsx
    ActiveCallDock                                     features/communications/voice/active-call-dock.tsx
```

Two facts about this tree matter later.

1. `ActiveCallDock` is a sibling of `OrganizationShell`, not a child of it, so it sits **outside**
   `SidebarProvider` and `WorkspaceRailProvider`. It cannot read the Agent state, the sidebar
   state or any shell geometry. It positions itself with its own `fixed inset-x-0 bottom-0 z-50`.
2. `AppShell` renders `bottomBar` inside `SidebarProvider`, and `WorkspaceShell` renders the bottom
   bar inside `WorkspaceRailProvider`. So a bottom-bar control can call `useSidebar()` and
   `useWorkspaceRail()` with no new provider.

`features/account/global-fallback-shell.tsx` is the only other `WorkspaceShell` caller. It passes
`navigationTrigger="always"` and **no** bottom bar. Any change to the header's phone controls has to
keep that shell working.

---

## 3. Navigation source-of-truth map

### Information architecture: `lib/navigation.ts`

- `WORKSPACES` (lines 61–70) registers nine workspaces. Six have a `home` segment: CRM (`sales`),
  Communications (`comms`), Finance, Automations, Field, Studio. **Marketing, Support and AI
  declare `home: undefined`** and have no operating page, so `projectShell` draws no row for them.
- `Area.phone` (line 290) is set on three areas: `customers` (line 346), `work` (385), `schedule`
  (386). This flag is purely a phone-presentation choice sitting in the IA file. It is the only
  phone-specific field in `navigation.ts`, and it becomes dead under `Home | AI | Menu`.
- Library is an `AREAS` entry in its own `library` group (line 340), not a workspace.
- The comment at line 554 (`OrgNavBar (flat, phone)`) describes a rendering that no longer
  matches `OrgNavBar`'s role once the bar has three controls.

### Eligibility and projection: `lib/shell.ts` → `projectShell()`

`projectShell` (lines 206–277) is the only place that combines entitlement, capability, GildOps
identity and platform authority. It produces `ShellSection[]` of `NavItem`s, with workspace rows as
`{ href: workspace Home, heading: true, children }` and Platform as a workspace-style parent row.

What belongs to it and stays untouched:

- `projectShell`, `projectPlatform`, `businessSettingsOffered`, `projectedItems`, `itemContains`,
  `activeItemKey`, `inPlatformScope`, `SHELL_SECTION_ORDER`, `ADMINISTRATION_SECTIONS`.

What in `lib/shell.ts` is phone presentation only and becomes obsolete:

| Symbol | Lines | Why it goes |
|---|---|---|
| `projectPhone()` | 332–351 | Picks "Home + up to three `phone` pages + More". A three-control bar picks nothing. |
| `phoneMore()` | 386–404 | Flattens the hierarchy into sections for the old sheet. The new Menu keeps the hierarchy. |
| `expand()` | 362–383 | Helper for `phoneMore` only. |
| `PHONE_PRIMARY_WORKSPACES` | 314 | Used only by `projectPhone`. |
| `NavItem.phone` | 64–65 | Read only by `projectPhone`. |
| the two `phone` spreads | `areaItem` line 121, workspace row line 248 | Copy `Area.phone` onto items. |
| the `heading` comment about "the phone's More menu" | 66–70 | `heading` itself stays: the collapsed rail and Platform use it. |

**`phoneMore()` is not useful for the future Menu.** It exists to flatten a tree into lists. The
new Menu must show the tree (row body goes to the workspace Home, chevron expands children), and
`ShellSection[]` with `NavItem.children` already is that tree. Keeping `phoneMore` would keep a
second, lossy rendering of the same projection.

**Platform inside the Menu.** `projectShell` already produces Platform as one parent row
(`key: 'platform'`, `heading: true`) with Catalog, Commercial and Infrastructure as nested headings,
and `OrgNav` already expands the whole Platform branch while `inPlatformScope(pathname)` is true.
The Menu needs nothing new from the projection: Platform is the last section, drawn after Business,
and it is never a bar destination because the bar has no destinations beyond Home, AI and Menu. The
current `projectPhone({ platformActive })` branch, which swaps the bar's contents while the address
is inside Platform, has no equivalent and should not get one.

### Desktop rendering: `org-shell.tsx` → `OrgNav` / `NavRow` / `NavSubRow`

Link-and-disclosure rows built on `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSub` and
`Collapsible`. The open-state rule ("open while the person is inside, opens itself on entry, never
closes by itself") is written out **twice already**, once in `NavRow` (lines 210–217) and once in
`NavSubRow` (152–157).

### Current phone rendering

- `lib/shell.ts` → `projectPhone()`
- `org-shell.tsx` → `OrgNavBar` (lines 333–371) with `PhoneNavLink` and `PHONE_ROW`
- `components/navigation/more-menu.tsx` → `MoreMenu`

### Future presentation seam

`OrgNavBar` already receives `sections` from the one server-side model
(`loadOrganizationShellModel` → `projectShell`, called once, asserted by `adaptive-shell.test.ts`).

| Control | Behavior | Where it gets it |
|---|---|---|
| Home | Link to the organization's Home | The `home` section's first item in the same `sections` prop (`sections.find(key === 'home')`). Its `href` comes from `areaHref`, so the setup-or-today rule (D53) stays where it is. |
| AI | Toggle | `useWorkspaceRail().toggleAgent` and `agentOpen` for `aria-pressed`. Same call `AgentTrigger` makes. |
| Menu | Open | Either the sidebar's own mobile sheet (`useSidebar().setOpenMobile`) or a new component fed the same `sections`. See section 6. |

No renderer here reads a capability, module, role or platform permission, and none needs to.

---

## 4. Current phone behavior and defects

**Persistent controls.** Home, up to three `phone`-marked pages, and More. In a normal business that
is Home, Customers, Work, Schedule, More (five; `shell-projection.test.ts` line 303 pins the four
links). A business without Field pages gets fewer. Inside Platform the bar becomes Home plus every
first-level Platform destination, which is the "ten destinations in one bar" case the code comment
admits is the reason More exists.

**Overflow.** The list is `<ul class="flex gap-1 overflow-x-auto p-2">` (line 349) and each `<li>` is
`shrink-0` with a `PHONE_ROW` of `px-3 py-1.5` plus icon plus text label. Five items of that width
exceed a 320–390px viewport, so the row scrolls sideways. `docs/ui-spec.md` line 109 records this
as intended ("scrolls sideways"). This is the direct cause of the clipped, scrolling bar.

**Other bar defects found while reading:**

- The bar has no safe-area inset padding. `MobileDemoCta` pads with `env(safe-area-inset-bottom)`;
  `OrgNavBar` does not.
- `AppShell` reserves `pb-24` for the bar. That number is a literal, not tied to the bar's actual
  height. There is no canonical bar-height value in `workspace-geometry.ts`.
- Buttons sit at `py-1.5` with an 18px icon, which is below the usual 44px touch target.

**Current More behavior.** A modal `Sheet` from the bottom, `max-h-[85dvh]`, titled "More". It
renders flat lists. The workspace hierarchy is lost: a workspace with pages shows an "Overview" row
beneath a group label, and each page is a sibling link. Every link closes the sheet on click.

**Platform.** The bar's label changes to "Platform" and its contents swap while `inPlatformScope`
is true. More then leads with Platform's own pages (`platformFirst`) and follows with the business's
own sections.

**Current header controls on a phone.** From `features/shell/organization-shell.tsx`
(lines 139–157), left to right: `CompactContextSwitcher` (in `context`, `md:hidden`), the breadcrumb
slot, a flexible gap, `CompactAccountMenu` (in `beforeActions`, `md:hidden`), then `AgentTrigger`
(always rendered by `WorkspaceHeader`, icon-only below `sm`). The sidebar trigger is hidden below `md`.

**Agent panel versus the bottom bar (found; needs a decision in Slice 1).** On a phone
`panelClass('agent', 'phone', …)` is `fixed inset-x-0 bottom-0 z-40 h-[85dvh]`. The bottom bar is
`z-20`. An open Agent panel therefore **covers the bar**. If `AI` lives in the bar, it is hidden
under the panel it opened, and the only ways to close it are the panel's own X button (the panel has
no Escape handling; it is non-modal by design). The page-support rail has the same stacking in the
phone layout.

---

## 5. Existing Agent ownership

```text
WorkspaceRailProvider                  workspace-right-rail.tsx:124   state: agentOpen, agent (ReactNode), agentWidth, layout
  AgentTrigger                         workspace-right-rail.tsx:236   reads agentOpen, calls toggleAgent; rendered only by WorkspaceHeader
    toggleAgent                        :146                           setAgentOpen(!open); setLatest('agent')
  AgentPanel                           :352                           mounts content from first open and keeps it
    ← agent content registered by      features/agent/tenant-agent-rail.tsx via useAgentContent(content)
  TenantAgentRail                      loads bootstrap on first open only (everOpened), keyed by organization
```

- **State owner:** `WorkspaceRailProvider`. `agentOpen` and `toggleAgent`/`closeAgent` are the only
  open/close operations.
- **Layouts** (`useRailLayout`, breakpoints 1720 / 1280 / 768): `wide` and `docked` put it beside the
  page as a resizable column; `overlay` (768–1279) floats it from the right; `phone` (<768) floats
  it from the bottom at 85dvh.
- **Persistence across presentation changes:** the panel is one element that only changes classes, and
  content stays mounted after first open, so a conversation survives close, reopen and a layout
  change.
- **Reuse for the `AI` button:** call `toggleAgent` and read `agentOpen` from `useWorkspaceRail()`.
  The `AgentTrigger` control itself is a header-shaped `Button size="small"`; the bar needs its own
  icon-and-label control reading the same two values. That is a second *trigger*, not a second
  Agent. `tests/component/agent-trigger.test.tsx` already holds the lazy-mount contract and should be
  extended, not replaced.
- **Header `AgentTrigger` below `md` after the change:** it duplicates `AI` in the organization shell
  and is required by `global-fallback-shell.tsx`, which has no bottom bar. `WorkspaceHeader` needs a
  prop (for example `agentTrigger?: 'always' | 'md'`), set to `'md'` by the organization shell. The
  rail and Agent content do not change. Desktop and tablet behavior is unchanged.
- `TenantAgentRail` and `agent-shared.tsx` need no change.

---

## 6. Authenticated Menu reuse decision

**Retire `MoreMenu` from organization phone navigation.** Refactoring it would mean turning a flat
list renderer into a tree renderer, renaming it, and changing its trigger, header, side and data
shape: nothing of the original survives. Its one remaining caller is `OrgNavBar`.

**The stronger option is not the named `mobile-app-menu.tsx`. It is the sidebar's own phone sheet,
which already exists.** The work order allows this ("unless inspection identifies a stronger existing
ownership location"):

- `Sidebar` in `packages/ui/src/components/sidebar.tsx` (lines 181–203) already renders its children
  inside a `Sheet` below 768px, controlled by `useSidebar().openMobile` / `setOpenMobile`. That
  breakpoint (`MOBILE_BREAKPOINT = 768`) matches Tailwind's `md`, which is what hides the bar.
- `OrgSidebar` is that children list: context switcher, the projected sections through `OrgNav`
  (with workspace row body to Home, chevron to expand, Platform expanded while inside it), and the
  account menu in the footer. `AccountMenu` already chooses `side="bottom"` when `isMobile`, so the
  primitive's mobile mode was anticipated.
- That sheet is **already mounted today** and simply has no trigger below `md`.
- Using it gives desktop parity by construction: one renderer of one projection, no third copy of
  the disclosure logic, and no second place that must learn about new item types.

The reason this was not used before is written down and no longer holds. `ui-spec.md` §2 and the
comment on `AppShell` (lines 16–21) refuse a phone drawer because it "needs a toggle, a focus trap and
an escape key to be correct". `Sheet` is a Radix Dialog and supplies all three (section 7).

**What option C does not give for free, to be settled in Slice 2 by looking at it in the running app:**

1. **Side.** The sheet opens from the left, matching `side` on the desktop sidebar. The marketing
   drawer opens from the right. `side` on `Sidebar` applies to both breakpoints, so choosing right
   would move the desktop sidebar. A per-breakpoint `mobileSide` prop on the shared primitive is the
   one fork a concrete deficiency could justify; accepting left needs no fork.
2. **Close on navigation.** Links inside the sheet do not close it; `MoreMenu` closes in `onClick`.
   A small effect on `usePathname` that calls `setOpenMobile(false)` covers it.
3. **Row geometry.** `SidebarMenuAction` is `md:opacity-0` (fine below `md`, where it is visible),
   and tooltips are off when `isMobile`. Touch size needs checking.
4. **Locked business.** `LockedOrgSidebar` has no bottom bar passed (`bottomBar` is `undefined` when
   locked), so Menu never appears there. Unchanged.

**If the Slice 2 screenshots fail on those criteria**, create
`apps/web/components/navigation/mobile-app-menu.tsx` rather than forking the primitive. It would take
`sections`, render the tree with `Collapsible`, and need the shared disclosure rule extracted into
one hook (for example `components/navigation/use-branch-open.ts`) that `NavRow`, `NavSubRow` and the
new menu all call. It would also need `NAV_ICONS` moved out of `org-shell.tsx`: components importing
from a route folder is the wrong direction, and `OrgNavBar` currently avoids it by passing
`renderIcon`. `navigation.test.ts` line 20 imports `AREA_ICONS`/`NAV_ICONS` from `org-shell.tsx`,
so that move touches the test.

**Where the identity controls go (one authoritative placement).**

- *Account, Settings, Plan & usage, Sign out:* inside the Menu. Under option C they are already in
  the sheet's footer. `CompactAccountMenu` leaves the phone header.
- *Context switcher:* stays in the phone header as the one phone switcher, so a screen always says
  whose business it is. Under option C the sheet also contains `ContextSwitcher`, which duplicates
  it. Slice 4 should decide whether the header mark becomes a plain label or the sheet's copy is the
  only switcher. The audit's recommendation is the header keeps the mark and the switcher, and the
  sheet shows the current business as a heading, so there is exactly one place to switch. This is a
  product choice for the owner, not something the code decides.

---

## 7. Shared primitives

**`packages/ui/src/components/sheet.tsx`** is a Radix Dialog (`radix-ui`). Modal: overlay, focus
trap, Escape and outside-click close, `aria-modal` semantics from Radix. `side` is `top | right |
bottom | left`; `left`/`right` are `w-3/4` capped at `sm:max-w-sm`; `z-50`; slide animations on
`data-open`/`data-closed`. It includes a built-in close button unless the caller hides it (the
sidebar hides it with `[&>button]:hidden`). No deficiency found that justifies forking it.

**`packages/ui/src/components/sidebar.tsx`.** Mobile mode is `useIsMobile()`, 768px. Mobile width
is `20rem`. `SidebarMenuAction` and tooltips already branch on `isMobile`.

**`packages/ui/src/hooks/use-mobile.ts`.** Breakpoint 768, `getServerSnapshot` returns `false`.

**Breakpoint literals.** The value 768 appears three times independently: `use-mobile.ts`,
`TABLET_BREAKPOINT` in `workspace-right-rail.tsx`, and Tailwind's `md`. They agree today. The rail's
server snapshot is `'phone'` while the sidebar's is not-mobile, so the two can disagree for one
render on first paint. `workspace-geometry.ts` holds header height, `PAGE_PADDING` and drawer chrome
but **no breakpoint and no bar height**. A bar-height constant belongs there (section 14).

---

## 8. Marketing drawer map

`MarketingActions()` in `components/marketing/marketing-nav.tsx` (lines 82–136):

- Desktop (`sm` and up): `Log in` link, `Request a demo` button, menu trigger hidden.
- Phone: the right-side `Sheet`. Body: Products, then a bordered block holding `HEADER_LINKS` (How it
  works, Integrations, Pricing, Contact) and then `Log in` as a sixth link (lines 124–126). Footer:
  `Request a demo`, full width.

`Log in` is rendered as an ordinary row after Contact, which is the problem the work order states.

**The change is isolated to `marketing-nav.tsx`.** Move the drawer's `Log in` out of the link block
and into the footer region beside `Request a demo`, keeping `Request a demo` as the dominant
`ButtonLink tone="primary"`, with `Log in` as a secondary-weight control. Nothing else needs to
change:

- `marketing-header.tsx` only composes `MarketingNav` and `MarketingActions`.
- `marketing-shell.tsx` and `mobile-demo-cta.tsx` are a separate fixed bar outside the drawer
  (`sm:hidden`, `z-40`). Confirmed unrelated.
- `lib/marketing/navigation.ts` already has `ACCOUNT_LINKS` containing `/login` and `/demo`, used by
  the footer. The drawer may read it, but nothing in that file changes.

**Tests.** `marketing-homepage.test.ts` lines 21–23 only assert `href="/login"` appears in the nav
source, which stays true. `marketing-shell.test.ts` does not look at drawer structure. Neither
proves the hierarchy. A component test (jsdom can open a Radix Sheet and read the dialog's DOM order)
is the right level to assert "Log in and Request a demo share the footer region and Log in is not in
the link list". Visual placement at 320/390px is a screenshot job, not a test.

---

## 9. Current browser-call architecture

The softphone is present. It is not a token boundary awaiting a consumer.

### Outbound, as the code runs

```text
Customer record: CallCustomerSheet               features/crm/customers/customer-action-sheets.tsx:26
  PageDrawer "Call {name}"
    CallCustomerForm                              features/communications/voice/call-customer-form.tsx:32
      call() on "Call" press
        1. device.register() when status !== 'ready'
             TelephoneDeviceProvider.register     telephone-device.tsx:95
               mintBrowserTokenAction             calls/conference-actions.ts:57
                 browserTelephoneToken            lib/domain/reception/calls.ts:253
                   telephonyProvider().browserToken   lib/adapters/telephony/twilio.ts:117 (JWT, voice grant, incoming allow)
               new Device(token); device.register()
        2. dialCustomerAction                     conference-actions.ts:45
             placeCall                            calls.ts:157
               validate E.164; resolve acting account; callingNumber (the business's own)
               rpc open_call → call row + expected legs, room name "gold-<uuid>"
               provider.addToRoom(room, from, to, reportTo)   rings the CUSTOMER into the room (Record: 'true')
               on provider failure: calls.status = 'failed'
        3. device.connectToRoom(room, { callId, contactLabel })   telephone-device.tsx:142
             Device.connect({ params: { Conference: room } })
               Twilio → api/voice_outbound.py → conference_twiml: agent leg joins the room;
               the agent leg starts the room and ends it on exit
             attachCallHandlers → activeCall = ringing → 'accept' → in_progress
        4. ActiveCallDock renders from activeCall    active-call-dock.tsx:33
             polls listCallParticipantsAction every 4 seconds while callId is set
Carrier callbacks (no UI): api/voice_status.py, voice_recording.py → record_call_event
```

**Order is customer first, agent second.** The customer's phone is rung in step 2 before the
agent's browser joins in step 3. If step 3 fails, the call row says `ringing`, the customer is
ringing into a room nobody is in, and nothing in `CallCustomerForm` cleans up or marks the call.

**Probable defect, inferred from source and not reproduced.** `call()` reads `device.status` and
`device.connectToRoom` from the render in which the button was pressed. `connectToRoom`
(telephone-device.tsx:142–151) tests `status !== 'ready'` against the value it closed over. In a
fresh tab, `status` was `'offline'` at that render, so after `register()` succeeds the captured
`connectToRoom` still sees `'offline'` and throws "The dialer is not registered yet." That happens
**after** `dialCustomerAction` has already rung the customer. A second press would work, and would
place a second call. Needs reproducing in the first live verification (section 13).

**Registration is lazy.** `register()` is called from exactly one place, `CallCustomerForm`'s
`call()`. Nothing registers the Device when the shell loads. A person who has not pressed Call in
this tab has no registered Device.

**Token scope question for live verification.** `placeCall` resolves an acting subaccount
(`actingTelephonyAccount`) and `addToRoom` runs in it, but `browserTelephoneToken` calls
`telephonyProvider()` with no acting account (calls.ts:256). Whether a token minted that way can
join a conference in the subaccount depends on how the voice application is configured. It was not
resolved from source.

**`actingTelephonyAccount` is written twice**, in `calls.ts:20` and `conference.ts:71`. That is a
rule copied rather than extracted, the thing `CLAUDE.md` forbids.

### Inbound, as the code runs

```text
Device 'incoming'                                telephone-device.tsx:120
  setIncomingCall(call); attachCallHandlers(call, 'incoming', null)   → activeCall = ringing, callId null
ActiveCallDock: `incoming` branch               active-call-dock.tsx:65  "Incoming call" + Answer / Decline
  Answer → call.accept(); incomingCall cleared; dock switches to the active branch
  Decline → call.reject(); both cleared
```

**But nothing rings the browser.** `api/voice_inbound.py` verifies the signature and then always
returns `<Reject reason="busy"/>`. There is no `<Client>` dial anywhere in `apps/api/app`. The
token grants `incoming: { allow: true }` (twilio.ts, with a comment that says which numbers use it is
"a tenant's configuration and does not exist yet"). `routing_preview_inbound.py` previews routing
and does not place a call. So the incoming UI is reachable by an SDK event that the deployed backend
never produces.

**Defects in the inbound handler, read from source:**

- The `cancel` handler (telephone-device.tsx:85) clears `activeCall` and `callRef` but **not**
  `incomingCall`. A caller who hangs up before the agent answers leaves the dock showing "Incoming
  call" with a dead `Call` object.
- An answered incoming call has `callId: null` and `contactLabel: null`, so the dock shows "Call"
  with no participants, no hold control and no way to identify the caller. The code comment says the
  id is "identified server-side" once answered; no code does that.

---

## 10. Call state ownership

| State | Current owner | Durable or transient | Survives route? |
|---|---|---|---|
| Provider Device | `deviceRef` in `TelephoneDeviceProvider` | Transient (a token, a socket) | Yes within one organization's pages. Dropped on page reload. Inferred, not tested: switching to another business changes the `[organizationId]` segment, which should remount the layout, run `unregister`, and end the call. |
| Device status and error | `useState` in `TelephoneDeviceProvider` | Transient | Same as Device |
| Active browser call (`ActiveCall`) | `useState` + `callRef` in `TelephoneDeviceProvider` | Transient | Same as Device |
| Incoming call object | `useState` in `TelephoneDeviceProvider` | Transient | Same as Device |
| Durable call record | `calls` row via `open_call`, updated by `record_call_event` from carrier callbacks | Durable | Yes. Independent of the browser. |
| Participants | `call_participants` rows; `ActiveCallDock` holds a **copy** in `useState`, refreshed every 4 s | Rows durable; copy transient | Rows yes. The copy is rebuilt wherever the dock mounts. |
| Mute (local microphone) | `ActiveCall.muted` in the provider, from the SDK `mute` event | Transient | Yes |
| Mute (conference participant) | `call_participants` via `muteParticipantAction` | Durable | Yes. **No UI calls it.** |
| Hold | `call_participants.on_hold` via `holdParticipantAction` | Durable | Yes |
| Keypad open | `useState` in `ActiveCallDock` | Transient, presentation | Lost if the dock remounts |
| Transfer-number draft | `useState` in `ActiveCallDock` | Transient, presentation | Lost if the dock remounts |
| In-flight action key and action error | `useState` in `ActiveCallDock` | Transient, presentation | Lost if the dock remounts |
| Elapsed-timer clock (`now`) | `useState` in `ActiveCallDock`; `startedAt` is in the provider | Transient | Timer restarts correctly because `startedAt` is in the provider |
| Wrap-up | Nothing during a call. `WrapUpCallSheet` is reachable only from Calls history (`?widget=calls`) and writes through `wrapUpCallAction` → FastAPI `wrap_up_call` | Durable on save | Not offered when a call ends |
| Minimized / expanded | Does not exist | n/a | n/a |

**Presentation-owned state that future work should relocate or keep deliberately local.** The
participant copy and its poller live in the dock, so a second presentation (phone surface plus
minimized bar) would run a second poller or lose the data. The participant list should be owned once,
beside the provider, and read by every presentation. Keypad, transfer draft and action error are
fine to stay local to the controls component **only if** that component stays mounted across
minimize and expand.

---

## 11. Call capability matrix

"Mobile-ready" and "desktop-ready" mean the current UI is usable at that width. `ActiveCallDock` is
one full-width `fixed` bar with `flex-wrap`, a 160px text input and no responsive variants, so
neither column is a yes in the strong sense. Read as: **works but unreviewed**, and nothing here has
been opened in a browser.

| Capability | Domain / server exists | Current UI exists | Mobile-ready | Desktop-ready |
|---|---|---|---|---|
| Outbound call | Yes: `placeCall`, `dialCustomerAction`, `voice_outbound.py` | Yes: `CallCustomerForm` (customer record only) | No: sequence has a probable defect and a customer-first order (§9) | No: same |
| Incoming answer / reject | Browser side yes (`incoming.accept/reject`). **No backend rings the browser** (`voice_inbound.py` rejects) | Yes: banner in dock | No | No |
| Mute | Yes, two kinds: SDK local mute; `muteParticipantAction` | Local only | Unreviewed | Unreviewed |
| DTMF | Yes: `Call.sendDigits` | Yes: 12-key pad | Pad is a fixed `w-48` grid; unreviewed | Unreviewed |
| Hold / resume | Yes: `holdParticipantAction`, `updateParticipant` | Yes, for **customer** participants only, after the 4 s poll fills the list | Unreviewed | Unreviewed |
| Participant add / remove | Yes | Yes: one number field, **Add**, and a **Remove {party}** button per non-customer participant | Unreviewed | Unreviewed |
| Warm transfer | Yes: `warmTransferAction` | The **Add** button adds a `transfer_target`, which is what `warmTransfer` does; no "transfer" control or wording | No | Partial |
| Cold transfer | Yes: `coldTransferAction` (needs `transferringParticipantId`) | **None** | No | No |
| Recording state / control | Recording is requested at `addToRoom` (`Record: 'true'`) and callbacks persist metadata (`voice_recording.py`). No pause, stop or state API | **None** | No | No |
| Device / output selection | **None found**. No `setSinkId`, `audio.availableOutputDevices` or `enumerateDevices` anywhere in `apps/web` | None | No | No |
| Wrap-up | Yes: `wrapUpCallAction` → `wrap_up_call` → `record_call_outcome` | Yes, from Calls history only. Not shown when a call ends | n/a | n/a |
| Dialer error display | Device and call errors set in the provider | Shown inside the dock **only while a call is active**, and inside `CallCustomerForm` | Unreviewed | Unreviewed |
| Dialing / connecting state | Not modeled | None. The form shows `dialing`; the dock does not exist until `activeCall` is set | No | No |

Distinction recorded as the work order asks: for hold, mute-of-participant, warm transfer, cold
transfer and recording, **backend or domain capability exists and UI presentation is incomplete**.
For incoming calls the **UI exists and backend ringing does not**. For output selection **neither
exists**.

---

## 12. Responsive dialer reuse and refactor map

| File | Classification | Why |
|---|---|---|
| `features/communications/voice/telephone-device.tsx` | **EXTEND** | It is already the one organization-global owner above the shell (`layout.tsx`), and no second provider is justified. It needs: richer session state, `register` on shell load for members who may call, a fixed `connectToRoom`, clearing `incomingCall` on cancel, and the stale header comment corrected. The `ActiveCall.status` union (`ringing`, `in_progress`, `closed`) is too thin for dialing, held, transferring, ending, wrap-up and minimized. |
| `features/communications/voice/active-call-dock.tsx` | **SPLIT** | It mixes four things: session reads, a participant poller, controls, and one full-width presentation. Split into a controls component and per-width presentations. Every current behavior maps to something that must survive: incoming banner, contact/status/timer, device-not-ready badge, mute, keypad, per-customer hold/resume, add number, remove non-customer participant, hang up, error line. |
| `app/organizations/[organizationId]/calls/conference-actions.ts` | **NO CHANGE** (callable surface complete) | It already offers every operation including warm and cold transfer and participant mute. `ActionResult`/`attempt` revalidates the Calls page on every call, including mid-call button presses; worth a look but not a reason to change the file now. |
| `app/organizations/[organizationId]/calls/actions.ts` | **NO CHANGE** | `wrapUpCallAction` is the wrap-up door; `placeCallAction` (form-state, no room) and `recordCallAction` are the two older initiation paths. `placeCallAction` rings a customer with nobody joining and is now the wrong act for a browser dial. A search of `apps/web` finds no caller; the comment in `conference-actions.ts` line 42 says it "stays for the Write it down form", but that form uses `recordCallAction`. Retire it in a later slice. |
| `features/communications/voice/call-customer-form.tsx` | **SPLIT** | The dial sequence (register, dial, connect) belongs in the provider as one command so any surface can start a call and the order and failure handling live once. The form keeps number entry and the "Write it down" record form. |
| `features/communications/voice/wrap-up-form.tsx` | **KEEP** | Reuse as is inside the session wrap-up step. It is a plain `useActionState` form posting `wrapUpCallAction`. Presentation needs a compact variant for the phone surface. |
| `features/communications/voice/wrap-up-sheet.tsx` | **KEEP** | Stays the Calls-history entry point (uses `PageDrawer`). The session flow reuses `WrapUpCallForm` directly, not this sheet. |
| `features/crm/customers/customer-action-sheets.tsx` (`CallCustomerSheet`) | **EXTEND** | Calls `startCall` and closes its drawer on success. It must not hold call state. |
| `app/organizations/[organizationId]/layout.tsx` | **EXTEND** | `ActiveCallDock` mounts here outside `SidebarProvider` and `WorkspaceRailProvider`. Layering with the bottom bar and the Agent panel needs the dock inside the shell, or shared geometry that reaches outside it. |
| `lib/domain/reception/calls.ts`, `conference.ts`, `lib/adapters/telephony/*`, `apps/api/**` voice files | **NO CHANGE** | The responsive UI does not need new provider commands for slices 6–10. One internal tidy: `actingTelephonyAccount` is duplicated. |

**Correction to the proposed plan.** A new "global call host" or call provider is **not needed**.
`TelephoneDeviceProvider` is that owner and is mounted above every organization route.

---

## 13. Documentation and comment contradictions

None of these are fixed here.

| File | Current statement | Current source reality | Correct in |
|---|---|---|---|
| `CLAUDE.md` ("Current state") | "One domain/runtime capability has no operator UI: `browserTelephoneToken` — the token boundary exists, but no browser softphone consumes it yet" | `TelephoneDeviceProvider` imports `@twilio/voice-sdk`, calls `mintBrowserTokenAction` → `browserTelephoneToken`, is mounted by `organizations/[organizationId]/layout.tsx`, and `ActiveCallDock` draws it. A softphone exists; what is missing is inbound ringing, richer call states, and live verification. | The first dialer slice (Slice 6) |
| `CLAUDE.md` ("Current state", M9 paragraph) | "browser softphone and realtime voice agent do not yet form the required end-to-end front desk" | Still true as a claim about the whole. Needs re-reading together with the sentence above so the two do not contradict. | Slice 6 |
| `docs/testing.md` line 232 | "Voice, softphone: call history renders; there is no browser softphone to test (M9/M14)" | A softphone exists and has **no component or browser test**. The honest wording is "exists, untested". | The verification slice (Slice 11) |
| `docs/testing.md` line 242 | Token test "partly closed" | Still accurate: `twilio-browser-token.test.ts` pins the token; the domain function and the provider are not tested | Slice 11 |
| `docs/walkthrough.md` lines 446 and 458 | "There is no browser softphone consumer", "no browser softphone consumes it" | Same contradiction as `CLAUDE.md` | Slice 6 |
| `docs/constraints.md` line 1235 | Mentions "before a softphone screen exists to call it" | Historical reasoning; read in context before editing | Slice 6, if it is a present-tense claim |
| `features/communications/voice/telephone-device.tsx` lines 12–14 | "Scoped to the Calls page today, not the whole organization shell" | `organizations/[organizationId]/layout.tsx` mounts it above `OrganizationShell`. The layout's own comment says so correctly. | Slice 6 |
| `features/communications/voice/telephone-device.tsx` and `active-call-dock.tsx` | "Everything here is unverified against a live call" | True, and remains true until live verification | Slice 11 |
| `lib/adapters/telephony/index.ts` lines 9–13 | "there is no `hold`, no `transfer` and no `merge` here yet" | `updateParticipant` (hold, mute, end a leg) exists, and the domain has warm and cold transfer | When the file is next touched |
| `docs/ui-spec.md` line 109 | Phone: "bottom bar, fixed, scrolls sideways; leads with the current context" | Superseded by `Home | AI | Menu`; the code matches the old text | Slice 1 |
| `docs/ui-spec.md` line 117 | "the phone bar and its More menu" | No More menu | Slice 1 |
| `docs/ui-spec.md` lines 231–235 | "The phone bar is Home, the first workspaces and More… `projectPhone`… behind **More**, a sheet" | Replaced | Slice 1 |
| `docs/ui-spec.md` lines 350–355 | "The sidebar is not there at all on a phone… `AppShell` hides the column outright… `OrgNavBar` beside `OrgNav`, both mapping the one `AREAS` list" | Under option C the sidebar's phone sheet is the Menu. Also `AREAS` is not what they map; `projectShell` is. | Slice 2 |
| `docs/ui-spec.md` line 395 | The sidebar trigger is hidden below `md` because the phone gets the bottom bar | Still true; wording to add that Menu opens it | Slice 2 |
| `docs/ui-spec.md` lines 444–447 | "On a phone the bar presents Platform while the address is inside it…" | No longer true; Platform is a section inside Menu | Slice 1 |
| `docs/ui-spec.md` line 52 and line 309 | "compact phone equivalent" of the account menu; "the sidebar (or phone bar) keeps one plain Setup row" | The phone header's compact account menu moves (Slice 4); no phone Setup row exists in `OrgNavBar` | Slice 4 |
| `app/organizations/[organizationId]/org-shell.tsx` lines 373–386 | Three orphaned doc comments ("The one Setup treatment…", "The phone's rendering of the same lifecycle treatment…") above `OrgSidebar` | They describe `SetupEntry` and `SetupNavLink`, which do not exist in the file. `OrgNavBar`'s parameter list also carries a dangling comment about SETUP, and `OrgSidebar`'s `email` prop carries a comment about SETUP. | Slice 1 (the bar is rewritten anyway) |
| `features/shell/organization-shell.tsx` lines 101–104 and 136 | "The sidebar row and the phone bar's first item both read this…", "A phone reaches Setup through `OrgNavBar`'s own first item while SETUP lasts" | There is no Setup row in either | Slice 1 |
| `components/layout/app-shell.tsx` lines 16–21 | A caller with `bottomBar` "must never also give the sidebar a trigger reachable below `md`" and `ui-spec` "refuses a phone drawer outright" | Option C opens the sidebar's phone sheet from the bar. The rule's reason no longer holds. | Slice 2 |
| `components/headers/workspace-header.tsx` lines 26–31 | "the bottom bar (`OrgNavBar`, which puts Platform first while in Platform Context)" | Will not be true | Slice 1 / 4 |
| `lib/shell.ts` lines 31–32 | "the phone bar and its More menu" | Replaced | Slice 1 |
| `lib/navigation.ts` lines 289 and 554 | `phone` described as "the phone bar's primary slots"; `OrgNavBar (flat, phone)` | Obsolete | Slice 1 |

---

## 14. Test impact map

### Static architecture (read source text; prove a rule, not a screen)

Assertions that **must change** with the product contract:

| File | Lines | What it asserts now |
|---|---|---|
| `tests/architecture/static/adaptive-shell.test.ts` | 135, 144 | Reads `components/navigation/more-menu.tsx` and loops over `['org-shell', 'more-menu']` for "no capability / module / role names". Retiring the file removes the second entry. |
| same | 163–164 | Expects `projectPhone(sections, { platformActive })` and `<MoreMenu` in `org-shell.tsx`. |
| `tests/architecture/static/navigation.test.ts` | 90 (title only), 784–800 (esp. 798) | Expects `projectPhone(sections, { platformActive })` in `org-shell.tsx`. The test title says "the phone bar alike — one shared predicate". |
| same | 844 | Slices `org-shell.tsx` between `export function OrgNav(` and `export function OrgNavBar(`. Still valid only while `OrgNavBar` keeps that name and order. |
| `tests/architecture/static/workspace-shell.test.ts` | 154–175, 239 | The "Business phone header" block pins `context` and `beforeActions` wiring and the `md:hidden` wrappers; line 239 expects `bottomBar={`. Slice 4 changes the first; the second stays. |

Should **stay unchanged:** `adaptive-shell.test.ts` lines 139–141 (`projectShell` called once; sections
handed to `OrgNavBar`), the no-role-names test, and `navigation.test.ts`'s icon coverage tests.
`marketing-shell.test.ts` and `marketing-homepage.test.ts` should stay unchanged.

### Unit

`tests/unit/shell-projection.test.ts`: the whole `describe('the phone renders the same projection')`
block (lines 295 to the end of its tests near 376) tests `projectPhone`, including the exact primary
list `['home', 'customers', 'work', 'schedule']` (303, 356), the ten `more` sections (309–323),
Platform-active behavior (331–347), and the minimal-business case (364–378). A second assertion at
558–563 ("the phone carries the same items, with the administration tiers behind More in the same
order") also calls `projectPhone`. All of these are deleted with `projectPhone`. The rest of the file,
which tests `projectShell`, stays unchanged and is the real guard for eligibility.

### Component (jsdom; interaction, focus, ARIA)

Existing: `tests/component/agent-trigger.test.tsx` holds the lazy-mount contract of the real rail.

Missing and needed:

- The new bar renders exactly Home, AI and Menu, and the AI control has `aria-pressed` that follows
  `toggleAgent`.
- Menu opens a dialog, a workspace row has a link to its Home and a separate Expand control with the
  right `aria-label`, and Escape closes it.
- Marketing drawer: Log in and Request a demo share the footer region.
- `TelephoneDeviceProvider` with a mocked `@twilio/voice-sdk`: incoming, accept, reject, cancel
  clearing the banner, and `connectToRoom` after a fresh `register`. This one would fail on the
  probable stale-closure defect.
- Call controls: mute, hold per customer participant, add, remove, hang up, error line.

### Browser / E2E (Playwright)

Existing assertions that must change: `e2e/adaptive-shell.spec.ts` lines 46–56 ("on a phone reaches
Business behind More, not in the bar", selecting `nav[aria-label="This business"].fixed` and a `More`
button) and lines 107–118 ("on a phone, are shown Platform as the active scope", selecting
`nav[aria-label="Platform"].fixed` and expecting `Organizations` in the bar). Both selectors and
expectations change. No existing E2E covers any call surface.

### Visual

None captures the phone bar, the Menu or any call surface. `CLAUDE.md`'s rule applies: each slice
that changes something a person sees needs a screenshot at desktop width, at 320px, and in the state
of a machine with a provider unconfigured. For telephony, that last state is "no carrier configured",
where `placeCall` refuses with `calls.telephony_unconfigured`.

### Live Twilio verification (manual; nothing replaces it)

Not done anywhere. Needed: place an outbound call from a fresh tab (reproduces or clears the probable
defect), hold and resume, DTMF, add and remove a participant, warm and cold transfer, recording
callback arrival, and incoming ringing once a backend path exists. Also whether the browser token
works against the acting subaccount.

### Tests found that bear on telephony but do not exercise the browser

`tests/contract/twilio-browser-token.test.ts` (token format), `tests/integration/database/
conference.test.ts`, `reception.test.ts`, `communications.test.ts`, `apps/api/tests/contract/test_voice.py`,
and the two static tests for the Communications workspace boundary. None of them renders
`TelephoneDeviceProvider` or `ActiveCallDock`. A search of `tests/` and `e2e/` for those names and
`useTelephoneDevice` returned no matches. I read the first two of those files' names, not their
bodies.

---

## 15. Exact implementation plan for the next work orders

Shell, in order. Each slice updates the documents and tests that it makes false, in the same change.

### Slice 1: `Home | AI | Menu`

Delivers the three-control bar, the Menu control opening the sidebar's phone sheet, and the removal
of everything the old bar needed. Slices 1 and 2 are split by risk: Slice 1 changes the contract,
Slice 2 makes the sheet good on a phone.

| File | Action | Why |
|---|---|---|
| `app/organizations/[organizationId]/org-shell.tsx` | MODIFY | Rewrite `OrgNavBar` to three controls; drop `PhoneNavLink`, `PHONE_ROW`, the `MoreMenu` and `projectPhone` imports and the orphaned Setup comments; add safe-area padding. `NAV_ICONS`, `AREA_ICONS`, `OrgNav` and the sidebars stay. |
| `lib/shell.ts` | MODIFY | Delete `projectPhone`, `phoneMore`, `expand`, `PHONE_PRIMARY_WORKSPACES`, `NavItem.phone` and the two `phone` spreads; fix the header comment. `projectShell` logic untouched. |
| `lib/navigation.ts` | MODIFY | Remove `Area.phone` and its three `phone: true` flags; fix the line 554 comment. |
| `components/navigation/more-menu.tsx` | RETIRE | No caller left. |
| `components/layout/workspace-geometry.ts` | MODIFY | Add the bottom bar's height as one canonical value (and its CSS variable) so `AppShell`'s `pb-24`, the Agent panel's phone bottom offset and later the call bar all read it. |
| `components/layout/app-shell.tsx` | MODIFY | Replace the `pb-24` literal with the canonical value. |
| `components/panels/workspace-right-rail.tsx` | MODIFY (decision) | Resolve section 4's stacking: either the phone Agent panel stops above the bar (recommended, so `AI` stays visible and pressed) or the bar is raised above it. Phone layout class only. |
| `features/shell/organization-shell.tsx` | MODIFY | Fix the Setup comments. Header changes are Slice 4. |
| `tests/unit/shell-projection.test.ts` | TEST | Delete the `projectPhone` blocks (295–376, 558–563). |
| `tests/architecture/static/adaptive-shell.test.ts`, `navigation.test.ts` | TEST | Replace the `projectPhone`/`MoreMenu` assertions with: the bar takes `sections`, names no capability, and has no `overflow-x` class. |
| `tests/component/` (new bar test) | TEST (CREATE) | Three controls, AI pressed state, Home link target. |
| `e2e/adaptive-shell.spec.ts` | TEST | Replace the two phone tests. |
| `docs/ui-spec.md` | MODIFY | Lines 109, 117, 231–235, 444–447. |

### Slice 2: the authenticated Menu on a phone

| File | Action | Why |
|---|---|---|
| `app/organizations/[organizationId]/org-shell.tsx` | MODIFY | Close the sheet on navigation (effect on `usePathname`); confirm account footer, switcher and Platform expansion inside the sheet; touch sizes. |
| `packages/ui/src/components/sidebar.tsx` | MODIFY **only if** the owner wants the right side | A `mobileSide` prop. Otherwise untouched. |
| `components/layout/app-shell.tsx`, `docs/ui-spec.md` | MODIFY | Remove the "no phone drawer" rationale (lines 16–21; ui-spec 350–355, 395). |
| `components/navigation/mobile-app-menu.tsx` | CREATE **only if** the Slice 2 screenshots fail | See section 6 for the exact fallback and its two extractions. |

### Slice 3: nested workspace navigation in the Menu

Under option C this slice is **verification, not construction**: row body to Home, chevron to
expand and the open-while-inside rule are `NavRow`'s existing behavior. It reduces to screenshots at
320px and 390px, a component test over the real `OrgNav` inside a mobile `SidebarProvider`, and an
E2E that opens Menu and expands a workspace. If the fallback component was created, Slice 3 is where
`use-branch-open.ts` is extracted and `NavRow`, `NavSubRow` and the menu all call it.

### Slice 4: phone header cleanup

| File | Action | Why |
|---|---|---|
| `features/shell/organization-shell.tsx` | MODIFY | Remove `beforeActions` (`CompactAccountMenu`); keep the context switcher per the section 6 decision; pass `agentTrigger="md"`. |
| `components/headers/workspace-header.tsx` | MODIFY | Add the `agentTrigger` prop (`'always'` default, used by `global-fallback-shell.tsx`); fix the Platform comment. |
| `components/navigation/account-menu.tsx` | MODIFY or RETIRE | `CompactAccountMenu` has no caller after this. Retire it unless Personal settings needs it. |
| `tests/architecture/static/workspace-shell.test.ts` | TEST | Replace lines 154–175. |
| `docs/ui-spec.md` | MODIFY | Lines 52 and 309. |

### Slice 5: marketing Log in hierarchy

| File | Action | Why |
|---|---|---|
| `components/marketing/marketing-nav.tsx` | MODIFY | Move the drawer's `Log in` into the footer beside `Request a demo`. The only production file. |
| `tests/component/` (new) | TEST (CREATE) | Footer region holds both; link list does not hold Log in. |
| `tests/architecture/static/marketing-homepage.test.ts` | NO CHANGE | Still true. |

### Slice 6 onward: the call session

Order follows dependencies. Each stays inside the existing provider.

6. **Session state and the defects.** `telephone-device.tsx`: widen `ActiveCall.status` and add
   `dialing`, `held`, `ending`, `wrap_up`; fix the stale `connectToRoom` closure; clear `incomingCall`
   on `cancel`; register on shell load for members who hold `call.place`; correct the header
   comment; correct `CLAUDE.md` and `walkthrough.md` in the same change. Add the provider component
   test.
7. **One start command.** Move register, dial, connect into the provider as `startCall`, with the
   order and cleanup decided once (join the room before ringing the customer, or mark the call failed
   if joining fails). `CallCustomerForm` and `CallCustomerSheet` call it. Retire `placeCallAction` if
   confirmed unused. Extract `actingTelephonyAccount` from `calls.ts` and `conference.ts`.
8. **Shared controls and one participant owner.** Split `active-call-dock.tsx`: a controls component
   and a participant hook (one poller), both mounted once. Add the missing controls the domain
   already supports: participant mute, cold transfer, and a clear warm-transfer action.
9. **Phone presentation.** Full-screen active surface, a minimized bar above the bottom bar using the
   canonical bar height from Slice 1, and a phone incoming surface. This needs the dock inside the
   shell's providers, or a geometry variable that reaches outside them, because it currently sits
   outside both. Add `minimized` as session UI state.
10. **Desktop presentation.** A persistent right-side panel and a compact dock. This touches the rail
    system: `Panel = 'agent' | 'page'` and the `showAgent`/`showPage` rules assume two panels, and
    the Agent already owns the right edge. Decide whether the call panel is a third panel or shares
    the Agent's column before building.
11. **Wrap-up in the session.** Show `WrapUpCallForm` when a call ends, in a phone-sized layout;
    update `docs/testing.md`; add component tests for the call surfaces and an E2E that places a call
    against a stubbed `Device`.
12. **Inbound end to end.** Backend work, separate from the UI: `voice_inbound.py` must ring the
    browser Client for routed numbers, with the routing preview as input, and the answered call must
    be identified (`callId`, `contactLabel`) server-side.
13. **Live verification and output selection.** The manual checklist in section 14, and a decision on
    whether device and output selection is wanted at all.

---

## 16. Not decided here

- Whether the Menu sheet opens from the left (zero fork) or the right (a `mobileSide` prop on a
  shared primitive).
- Whether the phone Agent panel stops above the bar or the bar sits above the panel.
- Whether the header keeps the context switcher once the Menu holds the business heading.
- Whether the call panel is a third rail panel or shares the Agent's column.
