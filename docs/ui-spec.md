# UI specification

Admitted as a Tier 1 document by D23's trigger, which fired when the second and third surfaces
shipped and went unnoticed until the fifth. `constraints.md` D23 holds the decisions; this
document holds what three surfaces' worth of navigation models are too much for one decision
record to carry. Where the two disagree, D23 governs.

Harvested from `tire-app-template/docs/ui-spec.md` the way D1 says to harvest — the reasoning,
cited, never the code, and not all of the reasoning. That source is a single-tenant application,
so **everything it was free to hardcode is exactly what this platform is not**, and its §15
status system is the specific thing D23 refuses.

**This document holds decisions and never values.** Why a colour role exists, why a status is
styled neutrally, which rendering an area gets — those are here. The hex codes, the spacing scale
and the class strings live in `apps/web/app/globals.css` and in the control files, and are cited
from here rather than copied. D23 refuses a design-tokens document under D8's never-write list,
and a spec that starts listing values has become one by a longer route.

**§4 was the empty half and is now filled in**, by the change that wrote the controls rather than
ahead of it. What is recorded there is what was built and what it replaced.

---

## 1. The surfaces

Six, and only two of them share a navigation model. That is the reason this file exists rather
than another paragraph in D23.

| Surface | Whose it is | Navigation | Where |
|---|---|---|---|
| GOLD's front page | a stranger | GOLD's own header and footer (`SiteShell`) | `app/(marketing)/` |
| Operator shell | a business's own staff | full IA, three renderings (§2) | `app/organizations/[organizationId]/` |
| Public booking | a stranger with no account | none — one linear flow | `app/(public)/book/[slug]/` |
| Customer portal | one customer of one business | none — a single page of their own things | `app/(public)/portal/[token]/` |
| Platform console | GOLD staff, members of nothing | none — one list, deliberately no sidebar | `app/(platform)/platform/` |
| Auth | anybody | GOLD's own header and footer (`SiteShell`) | `app/(auth)/` |

Three consequences that are easy to undo.

**Only the operator shell has an information architecture.** The others are flows or single
pages, and giving any of them a sidebar would import an operator's mental model into a place
where it means nothing. A customer must never meet a business-configuration concept, and a
stranger booking a slot must never meet one at all.

**`SiteShell` is GOLD's chrome and belongs on GOLD's pages only** — the front page and the four
credential screens, which is why those two rows share a description above. It is a header saying
GOLD and a footer saying GOLD, and on `/book/{slug}` or `/portal/{token}` that would be our
wordmark on somebody else's shop front. D20 keeps the platform out of a tenant's frame entirely,
and `public-profile.test.ts` now fails the build on a `SiteShell` anywhere under `app/(public)/` —
the structural form of the sentence rule the rest of that suite enforces.

**The platform console has no `navigation.ts` entry and must not gain one.** Those nouns belong
to a business and the console is not one. `navigation.test.ts` scans
`organizations/[organizationId]/` for areas, which is why that directory is ungrouped while
these four are grouped.

---

## 2. The three renderings

The information architecture does not change across breakpoints; only its presentation does.
`apps/web/lib/navigation.ts` holds the one set of areas and
`apps/web/app/organizations/[organizationId]/org-shell.tsx` renders it. (This file named
`components/org-shell.tsx` until the path was corrected — that directory is for what more than
one surface needs, and the shell serves one.)

**All three renderings exist.** The tablet rail is M11's: icon-only between `md` and `lg` over the
same `AREAS` list the other two renderings already map, an icon per area from `lucide-react` keyed
by segment in `org-shell.tsx` (`AREA_ICONS`) rather than in `navigation.ts`, which stays what it
was — segments, labels, groups, modules.

| | Navigation | Layout | Overlays | State |
|---|---|---|---|---|
| Phone | bottom bar, fixed, scrolls sideways | single column | sheets, sticky action bars | built |
| Tablet | rail, icon-only | two column | sheets or dialogs | built |
| Desktop | persistent sidebar | denser tables | dialogs | built |

**The sidebar is the desktop rendering of the IA, never its source.** Both renderings map the
same `AREAS`; two lists that had to agree eventually would not.

**Three sections, ruled apart, in `AREA_GROUPS` order** — Operations, Records, Configuration.
`navigation.test.ts` fails on an interleaved list: each section must be one unbroken run, and an
operator must never reach today's work by going through settings (D23).

The grouping comes from `starting_conversation.txt`'s four layers, with one deliberate difference.
That document's third layer is *business modules*, and it cannot be a section here: *module* is
the billing axis (D25), and Reports, Assets, Automations and Reception are all modules — so a
section by that name would have to hold areas belonging to all three of the others. Two axes
crossed in one list is how a sidebar stops making sense. These three are named for what an
operator does.

| Section | Holds | Why |
|---|---|---|
| Operations | Today, Work, Schedule, Resources, Ask, Reports | The loop that gets work done, and what it came to |
| Records | Customers, Calls, Locations, Assets | Who the work is for and what it is done to — entities rather than activities |
| Configuration | Pricing, Automations, Custom fields, People and roles, Guided setup, Settings | What a business sets up once and adjusts rarely |

A section whose every area belongs to a switched-off module renders as nothing at all, heading
included — naming a part of the application that is not there for that business would be worse
than the gap.

**The phone bar does not collapse into a drawer or a "More" menu.** A drawer needs state, a
toggle, a focus trap and an escape key to be correct; a "More" menu would be a second place an
area could live.

**The desktop sidebar does collapse, to the tablet rail's own icon-only width.** Unlike a phone
drawer this needs none of that machinery — nothing overlays, nothing traps focus, the column
just narrows — so `AppShell` (`components/containers/app-shell.tsx`) holds it as a `localStorage`
preference read through `useSyncExternalStore`, applying only from `lg` up. Still one `AREAS`
list; the identity block compacts the same way nav labels already did for the tablet rail, via
the shared `SidebarLabel`.

**The sidebar is not there at all on a phone.** It used to be, which put the business's identity
and the shell's own actions in a band above every screen while the same areas sat in the bar at
the bottom — two pieces of chrome and one duplicated list before any content. Below `md` the
areas are the bottom bar and everything else is the header, so `AppShell` hides the column
outright. The phone bar is `fixed`, and `display: none` on an ancestor takes a fixed descendant
with it, so that bar is a sibling of the sidebar rather than a second `<nav>` inside it —
`OrgNavBar` beside `OrgNav`, both mapping the one `AREAS` list.

---

## 2a. The header

**Every operator screen sits under one sticky header, and it answers *where am I*.** Scrolling a
long list of jobs is exactly when that stops being obvious, so it does not scroll away. It
carries its own background: the page moves underneath it, and a transparent bar shows rows
sliding through the text.

Three things, in the order they are read:

| | What | Which widths |
|---|---|---|
| Left | the business's mark and name, which opens the business chooser | below `md` only — the sidebar says it above that |
| Middle | where you are: the area's name, or a link back to it from a detail route | all |
| Right | account menu | below `md`; desktop account controls live in the sidebar footer |

**The area's `<h1>` lives here now, and it is still one string.** `navigation.ts` supplies the
navigation entry and the heading both, exactly as before — `AreaTrail` renders it, and what
changed is only where. A detail route is *in* an area and not *at* it, so there the header shows
the way back and the page writes its own `<h1>`, because a job's title is a tenant's words.

**Organization switching belongs to the organization identity.** The identity control opens the
existing business chooser; it does not manufacture a list or creation action without a server
read behind it. **Sign out belongs to the account menu**, in the sidebar footer on desktop and in
the compact header menu on a phone. Neither is an operating action or permanent page-header
command.

**The application canvas has named modes.** `AppPage` owns `reading`, `form`, `standard`, `wide`
and `full`, so an operations surface can use its workspace without every route inventing width
classes. Forms may remain focused inside a wide configuration canvas; `AppShell` itself never
imposes a universal content maximum.

---

## 2b. Widgets, and what an area opens onto

**An area may present itself as a dashboard of widgets**: tiles you read at a glance, any of
which opens as the screen. `components/display/widget.tsx` holds `WidgetGrid`, `Widget` and
`WidgetPanel`. Today is the first; the module areas follow.

**This is not the `dashboards` in `lib/domain/reporting/`, and the two must not converge.** That
one is a business's own arrangement of saved reports, and `CLAUDE.md` refuses to let the platform
seed one — including the four names in `roadmap.md` — because which numbers a business watches is
configuration and not four screens. This is how an *area* draws itself, which has always been the
platform's. A business still builds report dashboards on top of it.

| Rule | Why |
|---|---|
| The grid is CSS Grid, not a draggable layout | Today has product-owned placement. One column on a phone, two from `md`, and four on a very wide canvas gives dense, stable scanning without a persisted personalization model |
| A widget opens to `?widget=<key>`, never to remembered state | It survives a reload, arrives with the back button, can be sent to somebody, and reads its rows on the server under the caller's own RLS. None of that is true of a panel a component remembers |
| The expanded view replaces the grid; it does not cover it | Nothing overlays, so nothing traps focus and nothing needs an escape key. The way out is the way back |
| The title is the link, not the whole tile | A tile whose every pixel navigates cannot hold the rows that make it worth looking at — a link inside a link is invalid, and the overlay that works around it swallows text selection |
| No trend, no comparison, no percentage | The platform cannot tell whether a number moving is good or bad for a business it knows nothing about. Same reasoning as §7's neutral status |

`dashboard.test.ts` holds the second rule from both ends: `widget.tsx` never becomes a client
component, and a page linking to `?widget=` reads `searchParams` — a tile that opens onto nothing
is `navigation.test.ts`'s dead entry in another costume.

---

## 3. Colour roles

The values are in `apps/web/app/globals.css`. What belongs here is which roles exist and why.

That file defined **two** — `--background` and `--foreground` — which is the gap D23's amendment
records: refusing a tokens *document* was read as refusing the tokens, so every border was
`black/10 dark:white/15` written by hand and every hint was `opacity-70`. It now defines seven,
and each one names something the screens were already drawing without a word for it.

| Role | What it is for | What it replaced |
|---|---|---|
| background / foreground | the page, and the text on it | already existed |
| surface | a control or card sitting on the page | equal to the page in light, lifted in dark |
| border | the rule between things | `black/10 dark:white/15`, 24 hand-written spellings |
| muted | hint and help text | `opacity-70` |
| subtle | the quieter weight beneath it | `opacity-60` |
| danger | a refusal, an error, a destructive action | `red-600` in 34 places and `red-700` in 7 |
| accent / on-accent | emphasis, and the text on it — the primary button | `bg-foreground text-background` |
| accent-text | the accent used as *text*: a link, a focus ring | nothing; there was no link colour |

**Two muted levels rather than one**, because the screens were already making that distinction by
hand and flattening it would have been a design decision disguised as a cleanup. `danger` went
the other way: two reds nobody chose became one role.

Two rules about them.

**A control reads a variable, never a literal.** This is what makes a per-tenant theme a question
of where values come from rather than a second pass over every control — and that promise was
collected: the theme is **built** (D23, amended; `20260904000002`), and not one control changed
to get it. `BrandStyle` overrides the last three roles above on the shell and on both public
surfaces, and everything else on this page stays the platform's.

**The last three are the only ones a tenant may set, and the split is deliberate.** They default
to the platform's own look — `--accent` resolves to `--foreground` and `--on-accent` to
`--background` — so a business that has chosen nothing renders exactly what this application
rendered before brands existed. The first six are never a tenant's: a business overriding its own
page background can make its own text vanish, and a tenant recolouring what a *refusal* looks
like is §7's mistake wearing a brand. What a business gets is its colour, wherever this
application was already drawing emphasis.

**A tenant's colour is never used as written where it is used as text.** `--accent` is the colour
as chosen and is only ever a background under a foreground picked by measurement; `--accent-text`
is that colour moved in lightness until it reads on the page. Both come from
`lib/domain/branding/palette.ts` and nothing else may derive one — there is one contrast
calculation for the reason there is one price calculation.

**No role is named for a business meaning.** No `success`, no `complete`, no `pending`. Those are
statuses, the tenant owns them, and §7 is why.

---

## 4. The control set

Built. The set lives under `apps/web/components/`, in sub-folders named for the sections of this
document rather than for a taxonomy invented alongside it — so the file is under the heading you
would look the control up by. `components/README.md` carries the split and, more usefully, what
was moved *out* of the directory and on what test. No screen spells a control by hand.

| Control | File | Call sites |
|---|---|---|
| `Button` · `ButtonLink` — four tones, three sizes | `controls/button.tsx` | 88 · 4 |
| `TextInput` · `SelectInput` · `TextArea` | `controls/inputs.tsx` | 92 · 31 · 5 |
| `FieldLabel` · `Hint` · `ErrorText` | `controls/inputs.tsx` | 10 · 113 · 50 |
| `Section` · `SectionHeading` · `PageHeading` · `GroupHeading` | `containers/section.tsx` | 35 · 53 · 8 · 5 |
| `DividedList` · `EmptyState` | `containers/section.tsx` | 31 · 37 |
| `DataTable` — responsive; `TableScroll` · `TableHeaderCell` · `TableCell` | `display/table.tsx` | the lists and the reports |
| `Card` · `Disclosure` | `containers/card.tsx` | the boards and every create form |
| `Dialog` · `ConfirmSubmit` | `containers/dialog.tsx` | 10, every destructive action in the operator shell |
| `Badge` · `DefinitionList` · `Detail` · `Stat` · `StatRow` · `Toolbar` | `display/data.tsx` | the detail screens and Today |
| `cx` | `class-names.ts` | the others |

**What it replaced, measured before and after.** 23 local style constants across eight names —
`INPUT_CLASS` in ten files, then `INPUT`, `CELL`, `FIELD`, `BUTTON`, `SMALL_INPUT`,
`SELECT_CLASS`, `COORDINATE_INPUT` — are gone, along with every hand-written colour. The most
repeated class string in the application is now `mt-1`. Extraction had been attempted eight
separate times before this one stuck — each attempt looked like tidying up the file it was in,
which is the failure D23's last bullet describes.

**Spacing and layout stayed at the call site**, which is why `mt-1`, `flex-1` and `w-fit` are
still written out and should be. A control carries the rule, the type scale and the colour role.
It never carries a margin, because `mt-8` and `mt-10` were both in use and neither is wrong —
and never a width, because two width utilities on one element have no defined winner.

**The exception list is shorter than it was, and every entry now names a genuinely different
control rather than a file that had not been reached yet.**

- Three file inputs — a document, a logo — whose `file:` pseudo-element classes are a different
  control from a text field.
- `<input type="color">` and `<input type="date">`, on the brand form, the setup review and the
  schedule. Each is a picker the browser draws itself, and wrapping one in `TextInput` would put
  a border and padding around something that is already a control.
- One button on the booking page whose classes are chosen by a ternary per slot.
- `global-error.tsx`'s retry button (M11). The one screen with no access to the design system at
  all — it replaces the whole document on a root-layout failure, and Next does not load
  `globals.css` there, so every class name in `components/` would render unstyled.

**What left the list.** `create-business-form.tsx` spelled four controls by hand for a focus ring
the shared control lacked — this section named that as "a real gap" and it is now closed:
`inputs.tsx` carries the ring and the signup screen uses the set like everything else. Every
hand-written `rounded border border-border p-3` box became a `Card`, and the day controls on the
schedule became `ButtonLink`s.

**The acceptance test is an absence, and `milestone-m11.test.ts` is what re-runs it**: no file
under `app/` may spell a control by hand. The seven above are the whole of the exception list.

---

## 5. Containers

Not every interaction is a dialog.

| Use | For | Built as |
|---|---|---|
| Cards | lists of jobs, customers, resources, invoices | `Card` |
| Sheets | filters, quick actions, status changes, small forms | `Disclosure` |
| Full screens | complex forms, configuration, job and customer detail | the route |
| Dialogs | confirmation, and destructive actions only | `Dialog` · `ConfirmSubmit` |

**A sheet is `<details>` and `<summary>`, which is the whole implementation.** The browser opens
it, closes it, focuses it, labels it and reaches it by keyboard. `OrgNav` refused a drawer on the
grounds that one "needs state, a toggle, a focus trap and an escape key to be correct", and the
same argument settles this the other way round: the element that does all four already ships.

**What this replaced was every create form rendering permanently at the bottom of its screen.** A
business with forty customers ended its customer list with a create form, so the answer to *what
is on this page* was whatever fitted above a thing used once a week. A form is now available and
opens by default only when the list behind it is empty — because then the form *is* the screen.

**The outermost container declares its width and not only its margins.** `mx-auto max-w-2xl`
centres a block and does nothing useful in a flex parent, where an automatic side margin absorbs
the free space instead of stretching the item and leaves the box as wide as its longest line.
Every `<main>` outside the operator shell is a direct flex child of `<body>`, so each carries
`w-full` as well; `layout.test.ts` reads the source and fails on one that does not, because jsdom
implements no layout and a test that rendered these pages would have seen nothing wrong.

---

## 5a. Tables, and what a row is for

**A table is a set of rows somebody scans and then does something to.** The application's lists
were a link and two lines of middle-dot-separated text, so what could be *done* with a row was
never on the row: it was on the page you reached by clicking, or in a form at the bottom. `actions`
is therefore a slot on `DataTable` rather than a column — a row action is tertiary by construction,
which is why §6's one-primary-per-screen rule is not in tension with it.

**Below `md` a table is a list of cards, never a horizontal scroll.** A `overflow-x-auto` table on
a phone puts the columns that matter off the right edge and asks the reader to drag a grid
sideways to find out what a number refers to. Each card is the `primary` columns as a heading and
every other column as a label-and-value pair, so a value is never separated from the word that
says what it is. That is why `header` is required: on a phone it is not a heading, it is the label
on every single row.

Three column properties and no more. `numeric` right-aligns and sets `tabular-nums`, because money
in a ragged column cannot be compared at a glance. `emphasis: 'primary'` is the card's heading
line. `emphasis: 'secondary'` is dropped from the wide table and **kept in the card**, so the
phone shows more about each row rather than less — which is the difference between this and
hiding a column.

**A report is the other kind of table** — fixed columns, a totals row, nothing to do to any line —
and it uses `TableScroll` and the two cell components instead. Forcing it through `DataTable` would
mean an `actions` prop nobody passes and an `emphasis` on every column to say which one is a
heading.

**Sizing is by available space, not by breakpoint.** The boards and the schedule use
`repeat(auto-fill, minmax(…, 1fr))`, so a business with two vans gets two columns and one with
nine gets three, decided by the width there is rather than by a number somebody guessed.

---

## 6. Action hierarchy

**One primary action per screen**, secondary and tertiary beneath it.

Destructive actions are confirmed when consequential (M11). `ConfirmSubmit` is the one shape: a
trigger that opens a `Dialog` rather than submitting, and a Confirm button inside it that submits
the original form through the native `form` attribute — ten call sites across the operator shell
use it and none holds its own copy of the pattern.

**A row action is tertiary and sits outside this count.** Moving a job on, recording a meter
reading, setting a location's coordinates: each is one row's business rather than the screen's,
and §5a is why they are on the row at all. What the rule still forbids is two primary buttons
competing for the same page — which is what a create form permanently open at the bottom of a
list was, next to whatever the list itself offered.

---

## 7. Status, and why it is neutral

**The sharpest difference from the source, and the one most likely to be undone by somebody being
helpful.** The source fixes a nine-value vocabulary in a `STATUS_LABELS` constant and calls it
the single source. This platform cannot have that constant: `work_item_statuses` holds a `name`
the platform never translates and a `position`, with no `is_terminal` and no colour. A badge
cannot be coloured by what a status means, because the platform does not know what it means —
"Klaar" and "Awaiting parts" are the same shape of row.

**One neutral treatment, legible, the tenant's word rendered as written.** A colour becomes
possible when it is a column a tenant fills, added in the change where a screen reads it, and
never as a lookup keyed to English.

The tenant's own answers about meaning already exist and are deliberately narrow —
`releases_resource` and `marks_complete`, two questions rather than one flag. Neither is a
styling hook.

**`Badge` is where this rule now lives, and it has exactly one variation.** `tone="accent"` paints
a badge in the *tenant's* colour and says **this one** — who a job is assigned to, on a board
somebody is scanning — never *this one is good*. The tell that the rule has been broken is a
lookup keyed to an English word.

---

## 8. The words on screen

**Strings describing application state stay in code**: "Loading", "No results", aria labels, and
the sentences `outstandingModuleSetup` produces about what a deployment cannot do.

**Strings a business would make about itself are configuration**, and the public surfaces are
scanned for them — `public-profile.test.ts` reads the source of `app/(public)/` and fails on a
platform sentence appearing there. A business that has configured nothing renders its own name
and stops.

An empty state sits on that line and belongs to the first category. *No customers yet* is
application state. *Add your first customer to get started* is advice the platform has no
standing to give.

---

## 9. What this document does not decide

- **The marketing surface.** A per-tenant *site*, with pages and editable blocks, is still
  deferred under D20. Per-tenant **theming** no longer is: §3's last three roles are a tenant's
  and D23 carries the amendment. The two were one entry here because both were called *theme*,
  and separating them is what showed one of them had never been blocked.
- **A component-naming convention.** Refused by D23 under D8's never-write list. Name the file
  after the control.
- **Any value.** See the opening.
- **The desktop rendering of anything.** M10, where `packages/ui` is extracted because a second
  consumer exists — which §4's one set is what makes cheap.
