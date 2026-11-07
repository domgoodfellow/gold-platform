# Changelog

This file records **meaningful shipped changes by actual date**.

It is not:

- the roadmap;
- an implementation diary;
- a list of every commit;
- an architectural decision archive.

Use:

```text
docs/roadmap.md
→ what comes next

docs/decisions/
→ why durable architecture changed

Git
→ exact file/commit history
```

Dates use ISO format:

```text
YYYY-MM-DD
```

Entries describe the product or operational change, not every file touched.

---

## 2026-11-07

- A new business can start from another business its owner manages: "Choose a starting point" lists those businesses beside the templates. Choosing one copies its setup (kinds of work and their stages, steps, needs and online booking, fields, roles, opening hours, wording and menu order, who it serves, brand and customer forms) into a draft labelled with where it came from, to review and apply as usual. Customers, jobs, invoices, payments and prices are never copied. Setup offers the same choice until the business launches.
- Platform staff who look after the catalogue can save a business as a starting template from its page under Organizations. It is saved unpublished; Products lists every starting template, where staff publish, unpublish or rename them. Owners only see published ones.
- Business information asks who the business serves: people, companies or both. The three starting templates say who they serve.
- The demo records which template each business started from, and 小石川クリニック's owner also manages Grachtwerk Verhuur.

## 2026-11-06

- A new business can start from an industry template: Answering service, Rental and field service, or Appointment clinic. After creating a business the owner sees Choose a starting point, with the template matching their industry already chosen, or Start blank. The template opens on the setup review screen, where everything can be changed before Apply; nothing is set up until the owner applies it. Staff can choose a starting setup when provisioning a business, and an accepted sales proposal can carry one; either way the owner sees it on first sign-in, labelled as prepared by or agreed with GildOps, and can apply it, discard it or choose Not now. A setup can now describe several kinds of work, what each stage means, steps on each job, what each job needs, online booking, the business's own words and menu order, and forms customers can send from the portal. Applying is safe to repeat: if it stops part-way, the same setup is offered again and applying it finishes without making anything twice. The demo businesses are now built from two of these templates.
- A kind of work created in Work configuration starts with three stages, Booked, In progress and Done, instead of none. New work starts on the type's first stage.
- Platform pages now show confirmation messages after an action, such as provisioning a business or saving a provider account, and follow the signed-in person's appearance setting, as the rest of the app already did.
- Local development: `pnpm db:reset` now rebuilds the local database and then reseeds it with the demo, ending with a sign-in table (platform admin, owner and staff per demo business, and a customer portal link). The demo can be run again safely and adds nothing the second time. `staff@gold.test` now always holds every platform capability and belongs to the GildOps operating organization. The unused SQL seed entry is turned off.
- While `next dev` uses a local Supabase, the log-in page offers one button per demo account. While it uses any other Supabase, the organization header shows a HOSTED DATA badge. Neither appears in a production build.

## 2026-11-04

- Operator screens (workspaces, Settings, Setup and Platform) no longer print a sentence under a heading that restates it or describes the feature, and no longer put a small label above a card title. About 70 such lines are gone across CRM, Work, AI, Home, Finance, Support, Library, Insights, Setup, Automations, Communications, Settings and Platform. Where a sentence carried a real consequence, such as "turn receiving on only once the domain's mail records point at GildOps", it now sits beside the control it governs instead of under the heading. AI's Recent agent interactions panel is now titled Your recent agent interactions, and AI's text-only Insights panel is gone. Public pages, sign-in and tenant websites are unchanged.
- The rules for this are written down: `docs/ui-system.md` now opens with Core rules, workspace and feature screen specifications moved to `docs/surfaces/`, and `AGENTS.md` is the agent contract that `CLAUDE.md` imports. `pnpm check:ui-copy` reports any new subtitle, eyebrow or per-row info icon on an operator screen.

## 2026-11-02

- Every choice from a list now uses one styled control instead of the browser's own dropdown: a Select whose popup matches the rest of the app (theme, visual style, density, light and dark), marks the chosen option and works fully by keyboard, and which becomes searchable for long lists such as contacts, members, time zones and countries. The two industry fields now suggest values in the same style while still accepting any industry typed. Saved values, required fields, "None"/"Any"/"Unassigned" choices and filter addresses are unchanged.
- Communications and Automations dashboards now change their reporting period as soon as one is chosen, with no Apply button; Communications keeps its queue, channel, attention and search filters when the period changes.
- Keyboard focus now shows as a single outline on the control's own edge, in the page's text colour, everywhere. The previous ring sat apart from the control with a gap, and inside a personal visual style it was drawn twice. Focus stays visible in light and dark whatever a business's brand colour, and a choice made with the mouse no longer leaves the keyboard outline on a dropdown.
- Every invoice now has a branded PDF. While reviewing a new invoice, Preview document opens a draft marked DRAFT, with the business's current name, address, colour, fonts and logo; nothing is issued by previewing. Issuing an invoice records how it was presented and creates its PDF once; Download PDF in the invoice drawer and in the customer portal always serves that same file. Later changes to branding, logo, business details or catalog prices never change an issued invoice's PDF. If the PDF cannot be created, the invoice stays issued and Create PDF in the drawer tries again. The PDF states the invoice as issued; what has been paid since shows in Finance and the customer portal, not in the PDF. Invoices issued before this change get a plain PDF on request, without branding.
- An issued invoice can now be emailed to its customer from Send invoice in the invoice drawer, for someone who can issue invoices and send messages. The email comes from the business's own verified address, goes to the email on the customer's record, and carries the invoice's own PDF. Only the subject and message can be changed. Pressing Send again on the same email never sends it twice, and emailing an invoice a second time needs Send again. The drawer shows each send as queued, accepted by the email provider, delivered or not delivered, as reported, and links to the conversation in Communications where it is available. When the business cannot send email yet, Send invoice is unavailable and says what to set up in Settings → Email.
- Only the platform's server can now create an invoice's PDF or keep a copy of its logo. Previously, someone who could issue invoices could store a file of their own and have it recorded as the official invoice PDF or logo. Now the server draws the PDF from the invoice itself after checking the person may issue it, and every download is checked against the recorded file. A logo replaced shortly before an invoice is issued is left off, and the business name is shown instead of an earlier logo.
- An accepted one-off catalog proposal can now be invoiced from CRM → contact → Sales → Commercial proposals with Create invoice, for anyone whose role can issue invoices in a business with Billing in use. The invoice copies the lines and prices the customer accepted, never today's catalog; only the invoice and due dates can be chosen. Each proposal is invoiced once and whole; once invoiced, View invoice replaces the action. Proposal invoices share the business's invoice numbers, are labelled Proposal in Finance, link back to the proposal from the invoice inspector, and count in Finance totals, customer history and reports. Acceptance still invoices, charges and provisions nothing by itself, and issuing records no payment. Legacy Platform Plan proposals cannot be invoiced.
- A commercial proposal now only moves forward: a seller can mark a draft sent, and only the customer can accept or decline a sent version. A seller can no longer move a sent proposal back to draft or mark it accepted, and a proposal's terms can never be edited; a correction is a new version.

## 2026-11-01

- Finance → Invoices → New invoice can now invoice a customer directly from Catalog & Pricing items, with no Work item. The person chooses a customer, items and whole quantities; prices are copied from the catalog when the invoice is issued and never come from the browser. Direct invoices share the business's one invoice number sequence, appear in invoice and payment lists, customer history, the Dashboard and revenue reports, and open in Finance's invoice inspector, which now shows each invoice's source. Payments are recorded against an invoice of either source. Invoicing priced Work is unchanged.
- Invoices, invoice lines and payments are now written only by the issuing and payment functions; signed-in members can no longer insert rows into them directly. Two invoices issued at the same moment now take consecutive numbers instead of one being refused.
- CRM → contact → Sales → Commercial proposals is now available to any business whose Catalog & Pricing is in use, not only GildOps. A new version is built from the business's own catalog items and whole quantities; the database copies each item's name, unit and price, and the total, when the version is built, so a later catalog change never reprices a proposal the customer holds. Accepting a version records agreement only: no invoice, charge, business or Plan is created. Platform Plan proposals made before this change still read, send and are answered as before, and only they can be used to create a business in GildOps.
- Commercial proposals are now written only by `build_catalog_proposal`; signed-in members can no longer insert proposal rows or add-ons directly, and so can no longer set a proposal's price. New Platform Plan proposals can no longer be built.

## 2026-10-31

- A business can no longer set, replace or claim the processor customer that GildOps' subscription billing uses to recognise it. A billing manager can only reserve one; the customer is created by GildOps' API with GildOps' own key and recorded there by a machine role no person can use. A finalized customer belongs to one business per provider environment, and subscription events are matched only to finalized customers in the environment the signed event came from. Ambiguous matches are refused rather than guessed.

- Settings → Features now lists only features a business can use, with their setup and on/off actions. Planned or partly built features are no longer listed, labelled Included or offered as upgrades, and the server refuses to switch them on or off. What the plan does not include is one link to Plan & usage. Platform's organization commercial screen reads the same classification, so a partly built feature is shown there as Partial rather than Planned.

## 2026-10-29

- Setup now observes missing Work starting stages and optional CRM relationship stages, links to the authorized canonical editor and retains a return to the selected setup step. Zero-stage Work types open Workflow by default; name and scheduling saves remain independent. New quote distinguishes missing catalog, missing Work, unmatched search and permission restrictions, and explicitly created Work continues to its Financials. Schedule drops its duplicate timezone/hours header link, CRM stages use a compact collection with a consistent Add stage action, and compact focused dialogs share one width. Platform connector registration readiness is labelled Ready to connect rather than operational delivery.

- Financial reports now includes unsaved Economics & pricing planning: estimate delivery costs, calculate a target-margin selling suggestion and compare up to three scenarios beside current catalog prices. Unknown costs, documented zero assumptions, forecast profit and recorded finances remain distinct. The planner respects Finance report permissions and availability and changes no catalog, Work, invoice or payment records.

## 2026-10-28

- Organization Home now uses shared dashboard, collection and chart components for one cross-workspace overview. Work exceptions use W3's complete read model, Today/Upcoming include distinct local dates, and records are not repeated across attention, personal priorities and obligations. Attention and reporting controls keep separate URL state; source failures and refused browser-local Customize saves remain explicit.

- Dispatch now has one filterable Work queue and selected inspector, shared collection controls, focused assignment and scheduling dialogs, and optional Map or compact resource availability context. Schedule remains the full calendar. Dashboard and Dispatch share the seven local dates after the selected day for Upcoming; staffing gaps are distinguished from availability conflicts.

## 2026-10-27

- The Work Dashboard is easier to read. The header no longer prints the date and time zone; one date field changes the day straight away. Four figures lead the page (scheduled on that day, unassigned, unscheduled and requirements met), followed by Needs attention beside the day's schedule, a chart of scheduled work over seven days beside dispatch capacity, then upcoming work and recent activity. The separate Work status and Insights panels, which repeated the same numbers, are gone.
- Needs attention shows only categories that have something in them, and each opens Dispatch with the matching filter. Upcoming now starts the day after the chosen day, so a job is never listed twice.
- A business with no work yet sees one short step on its Work Dashboard (set up work types, add a starting stage, or create the first work) instead of a page of zeros. Work that is never scheduled is never asked for a date, a resource or a schedule.
- Work items uses the same toolbar as Contacts and Finance: work type, search, filters, sort and a List or Board choice. Dispatch is now a button next to New work instead of a third tab. Changing the work type clears a status filter that belonged to the old type, filters show as removable chips with Reset, and page numbers show the total number of pages.
- On Work items, each title opens the work, so the extra Open links are gone; Schedule or Assign appears only on work that still needs it. Phones and tablets show cards with only the details a job has, and the board scrolls on its own without moving the page.
- Each Work record section now has its own address, so Overview, Execution, Financials, Documents and Activity survive a reload, work with Back and Forward, and can be shared. Old links that opened Financials still do.
- The Work record's header now shows the type, stage and time, with an Edit details button. Overview shows only who the work is for, who is on it, where and on what, plus the business's own fields; empty details are left out, and support cases moved below them.
- Execution starts with the next step: the stage moves allowed from here, then the schedule and who is on it. Adding a step and recording time open only when asked.
- On a job's Financials, adding a priced line, issuing the invoice and recording a payment now open the same dialogs Finance uses. Costs are typed as money instead of in cents. A margin appears only once costs are recorded, rather than showing the whole price as profit.
- Edit details and New work type now open as centred dialogs that ask before discarding changes and keep what was typed when a save is refused. Creating a type still creates nothing else and goes straight to setting up its stages.
- Work type setup lists stages in order with where new work starts, shows allowed moves in that order, and explains that Booking controls online requests, not when work can happen.
- People who cannot change a job no longer see a line saying their role cannot; they just don't see the button.

## 2026-10-26

- Finance no longer has a Configuration row, Configure button or Payments & currency page. The trading currency and card payment settings now live in one place, Settings → General, in a Getting paid section; Catalog & Pricing links there. Old links, including ones to Getting paid, land on General.
- Finance no longer links to Commercial administration. GildOps staff reach it from Administration, as before.
- A business that has not recorded anything yet now sees its normal Finance Dashboard with a short Getting started panel that offers the next step (Set up pricing, then Price Work), instead of a separate start page. Customize dashboard stays available.
- Pricing wording now says what it does: Set up pricing, Add price item and Price item, instead of Add services. Adding a price item never creates a kind of work or a Work item.
- Settings → General now holds only the business profile: identity, address, contact and a new Regional settings section. The time zone and trading currency always show there, even before a country is chosen; a stored currency is never replaced by a suggestion.
- Getting paid moved from General to its own Settings page, Customer payments, and business words and page labels moved to Words & navigation. Old links to Getting paid, Finance's old configuration pages and the old Commerce page land on Customer payments.
- New work can now add a missing starting stage in place: someone who can configure Work types names the stage, adds it, and goes straight on creating the work with the same type chosen. Others see what is missing and can pick a type that is ready. The page is now a compact form.
- Work no longer has a Configuration row in the sidebar. Work types and scheduling hours open from Work items and Schedule, which stay highlighted while they are edited; old Work configuration links still work.
- Before anything is recorded, the Finance Dashboard shows one setup action in Getting started, with no competing button in the header, and one line instead of four separate empty messages. Add price item now always sits beside the price book heading.
- The Ambient 3D background is softer and fades out before the header buttons.
- Work's breadcrumbs now use the business's own name for Work items and Schedule (for example "Jobs" instead of "Work Items"), and Work's editors sit under the page they configure instead of a Configuration level.

## 2026-10-25

- A pipeline with no stages and no opportunities now shows a short setup message with a Configure stages button for people who can configure stages, instead of an empty board. The Unstaged column appears only when it holds opportunities or no stages exist.
- On tablets, the Contacts list keeps Search and Filters in view and moves sort and display into a View menu; the table switches to rows on narrower screens instead of cutting off columns. On phones, quick views scroll sideways and each row shows only the details it has.
- The Needs review view says what each contact is missing (person or company, lifecycle, or both), with a Classify link that opens the contact's edit dialog at the right section.
- Businesses can now set a palette instead of one colour: a primary, plus an optional secondary and highlight, with four starting palettes (Monochrome, Neutral with one accent, Complementary, Three colours). Every colour is adjusted where needed so text and selection marks stay readable in light and dark themes. Existing single-colour brands look exactly as before.
- Visual styles now look clearly different: Minimal is flatter with lighter borders, Layered adds a faint brand tint to selected items, and Expressive adds a brand edge to panels and the selected tab.
- Personal Appearance has a new Background choice: None (the default), Ambient gradient, Fine grid or Ambient 3D. It decorates dashboard introductions only. Ambient 3D falls back to the gradient on phones, on devices without 3D graphics and when it fails to start, and holds still when reduced motion is on.
- Finance has a clearer Dashboard: a financial overview (payments received this month, outstanding, overdue and quoted but not invoiced, each currency on its own line), a Needs attention list that shows only what needs action (overdue, due in the next seven days, ready to invoice, and card payments only when they are switched on but not connected), recent financial activity, and collections for people who can see reports. A business that has not priced anything yet sees a short getting-started path instead of empty figures.
- The price book is now its own Finance page, Catalog & Pricing, next to Quotes, Invoices, Payments and Financial reports. The trading currency and payment collection settings moved to Finance Configuration, now called Payments & currency. Old links still work.
- New quote, New invoice and Record payment open focused dialogs instead of a side panel. A quote adds a priced line to a Work item and previews the new total. An invoice is reviewed and then confirmed in a separate step before it is issued. Recording a payment shows what is owed; a correction or refund is chosen explicitly, shown in red and confirmed before it is added, and earlier payments are never changed.
- The Finance Dashboard now has real charts: payments received over the month (corrections show below zero), receivables by how far past due, invoiced amounts beside recorded costs for the top customers, and invoices by status. Each chart shows one currency at a time, can be switched to bars or a table where that stays truthful, and can be read with the keyboard.
- Customize dashboard lets each person arrange their own Finance Dashboard: move widgets, make them wider or narrower by dragging or with buttons, choose how a chart is shown, and hide secondary widgets. The layout is saved per person and per business, and Reset brings back the standard layout. Nobody sees a chart they are not allowed to read.
- The Finance Dashboard header now fits on one row at every screen size: below wide desktop, New quote, Record payment and Payments & currency are in a More menu, and on phones Customize dashboard is there too. Panels in the same row now line up, a one-day trend shows its amount, and an unknown cost is labelled Unknown in charts.
- On the Invoices list, Preview opens a side panel with the invoice's dates, amounts, lines and payment history, a link to the full record, and the usual Record payment dialog. Closing it returns to the same filtered list.
- Quotes, Invoices and Payments lists have quick views (for example Overdue, Due soon or Corrections), a Filters panel with removable filters, sorting and page numbers, all kept in the address. Overdue and settled invoices are marked with a word and an icon as well as colour, and payment entries say whether they were recorded by hand.

## 2026-10-24

- CRM contact records now open with who the contact is (type, company, lifecycle, temperature and stage as labelled chips, plus how to reach them) and group their pages into seven sections: Overview, Sales, Tasks, Activity, Related, Documents and Portal. Old links to a record's tabs still land in the right place. Editing a contact, creating or editing an opportunity, and editing opportunity stages now happen in focused dialogs. Contacts that still need classifying offer a Classify contact button.
- New contacts are no longer assumed to be Leads. A contact created by hand keeps the lifecycle you choose, or none. Imports can set a lifecycle for new rows only; a lifecycle column still wins, and existing contacts are never downgraded by an import default.
- Relationship stages are managed directly on their page: add, rename, move up or down, and remove a stage only when no contact uses it. Both pipeline boards have clearer columns and cards, scroll within the board, and can be reached by keyboard.
- The Contacts list leads with each contact's identity, has quick views (All, People, Companies, Needs review), keeps less common filters in a Filters panel with removable chips, and groups people under their company without repeating anyone.
- The organization header no longer shows a Calendar button; the CRM calendar opens from the CRM Dashboard and Tasks. Appearance settings now visibly change CRM lists, tables, boards and dialogs, and the preview shows them.
- CRM has one Add contacts button on the Dashboard, the Contacts list and their empty states. It opens a dialog with three choices: create a person or company, import records, or use a connected spreadsheet. Choices a person's role can't complete explain why instead of failing later. Creating a contact now happens in a centered dialog: choose Person or Company, fill in the essentials, and save, or add lifecycle and the business's own fields first. A new company can be created on the spot without leaving the person you are adding. Importing is a guided series of steps in Library: choose a source, map columns, review what will change, confirm, and see the results.

## 2026-10-23

- The CRM Dashboard puts relationships first. It opens with contact counts (people, companies, unspecified), contacts added in the last 30 days and the lifecycle mix. Next comes the main list: the contacts most recently dealt with, ordered by calls, completed tasks, lifecycle changes and opportunity progress, never by edits to contact details, with an optional Group by company view. Needs attention lists overdue tasks and tasks due later today separately, and becomes one short line when nothing needs doing. Opportunities & Pipeline appears only when the business uses opportunities, or as brief setup guidance for people who can set up stages. New businesses see the same layout instead of a separate setup page.

## 2026-10-22

- CRM stabilization adds disposable browser acceptance for contact identity, affiliations, reviewed imports and preserved history. Fixture teardown now finds restrictive children behind cascading relationships without disabling database enforcement; browser assertions follow the accepted Dashboard and Contacts labels. Database-test isolation supports a separate mail catcher and consistently targets the test database for Portal expiry probes. The credential boundary scan remains unchanged; privileged fake-email fixture setup lives in test support.

- Workspace navigation now offers an explicit Gauge Dashboard at each existing landing route, with a plain contextual heading. CRM uses Contacts and the opportunity Pipeline while preserving relationship-stage and Follow-up routes.
- Contacts support independent lifecycle and temperature, preserving existing unclassified records and canonical identities. Library intake shares source selection, CSV reuse, classification mapping, duplicate review and reports; saved worksheet synchronization opens reviewed updates and protects local edits and contacts removed from a source. Automatic CRM scheduling is not enabled.
- CRM now has one contact identity for people and companies. Existing records keep their IDs and every link to opportunities, finance, communications, work, documents, portal access and imports, and stay Unspecified until someone classifies them. New contacts must be a Person or a Company, and people can be affiliated with companies, with history kept. CRM lives at `/crm`, `/crm/contacts`, `/crm/pipeline` and `/crm/opportunities/{id}`; old `/sales`, `/customers`, `/opportunities` and `/follow-ups` links redirect for a limited period. Follow-ups are CRM tasks attached to their contact or opportunity.

## 2026-10-21

- Correct operational panel composition: shared inset gutters, explicit edge-to-edge tables/lists, compact Work Home metrics without duplicate navigation, consistent small Work toolbar controls and sidebar workspace glyphs aligned with child rows.
- Move New work to one permission-checked creation page shared by Work Home, Work Items and Schedule, retaining type deep links, setup prerequisites, domain validation, draft protection and return to Work Items.

## 2026-10-21

- Settings → Features is now a searchable catalogue: usable features are listed by product with their actions, while features outside the plan and planned features are folded beneath each product with one explanation (planned features no longer suggest they can be bought). A setup warning shared by several features is shown once. The page is about 56% shorter for a fully entitled business and 86% shorter for one with a small plan.
- CRM Home lists today's follow-ups once, in Today, and Needs attention shows only exceptions. The pipeline shows its stages without repeating the opportunities list, the month picker sits beside the forecast and win rate it controls, and recent activity opens from an Activity button. A new business sees one getting-started panel. Marketing Home drops the cards that repeated the sidebar, lists draft campaigns once, and says once when there is nothing yet; Support Home drops its grid of links to Cases, Queues, Service levels and Reports, which the sidebar already shows.
- Several small tasks no longer open a full-height side panel. Confirming a Marketing campaign status change is now a short dialog ("Activate campaign?"). Team's Add member is a focused dialog that still offers invite by email or adding an existing account, and still says truthfully whether the invitation email went, with the link to share yourself when it did not. Home's Customize opens a small popover beside the button. A Studio form's sharing options (links, website, portal, embed and where it is used) are now a Sharing section on the form's own page instead of a Distribute panel. Price items are added and edited directly in their row of the price book; a refused save keeps what was typed. Closing either dialog returns focus to the button that opened it.
- Configure menus now list pages owned by Organization Settings (Studio's Branding, Public profile and Domains; Communications' Email sending) under an "Organization settings" heading. Support's Configure panel shows its queue and service-level details separated by dots instead of question marks.
- No workspace has a Configuration landing page any more: each was only a list of links the sidebar already showed. Communications, Work, Studio and AI Homes now offer a Configure menu that goes straight to each page; Finance offers one direct Services & pricing link, because its two entries opened the same page. In the sidebar, a workspace's Configuration is a direct link when there is one page and a heading that opens and closes its pages when there are several. Old addresses such as `comms/configuration` take people to the first page they may open, or show not-found. Communications no longer lists "Recording & compliance (information)", which only jumped to a section of Calling & routing; Marketing and Automations no longer carry a Configure setting that could never show anything; and the Dialer's Configure offers only calling pages.
- CRM configuration is easier to reach. CRM Home's Configure button opens a menu of Relationship stages, Opportunity stages and Customer fields (only the ones a member may change), instead of a page listing the same three links. In the sidebar, CRM's Configuration heading now opens and closes its pages rather than going to that list; the old address takes people straight to Relationship stages, or the first page they may open. Breadcrumbs show Configuration as plain text. The Customers page no longer has a Configure panel that repeated two of those links, and the Relationship pipeline links directly to Relationship stages. Other workspaces are unchanged.
- On tablets (768–1279px) the sidebar now starts as the icon rail, giving pages about 230px more width (663px instead of 431px at 768px). The toggle opens the full navigation over the page, without squeezing it, with a Close navigation button; Escape, clicking outside or choosing a page also closes it. Phones keep the menu sheet. On desktop, collapsing or expanding the sidebar is now remembered across reloads (it was saved but never read), and a reload no longer briefly shows the wrong layout.
- The New customer, opportunity and follow-up panels now work like Customer fields: Add customer / Save opportunity / Save follow-up and Cancel stay in a fixed footer, closing with unsaved changes asks first, and an unchanged panel closes at once. A refused follow-up no longer clears its title, due time, owner and notes, and a refused new customer keeps what was typed; focus moves to the reason. Saving an opportunity still opens it, and a completed follow-up, or one a member may not manage, still shows no save action.

## 2026-10-20

- Customer fields' New field and Edit panels keep Add field / Save changes and Cancel in a fixed footer. Closing a panel with unsaved changes, by the close button, Escape or Cancel, now asks before discarding them; an unchanged panel closes at once. A refused save, such as a key that already exists, now keeps what was typed and moves focus to the reason, and Escape keeps working afterwards. The edit panel shows Label, Position, Required and Choices as labelled fields. Other panels are unchanged until they adopt the same behaviour.
- Work Home's Manage Work list now comes from the Work workspace's navigation. It uses the same labels as the sidebar, including a business's own names, and offers only pages the member may open. Scheduling & hours no longer appears for a business that schedules no work, where that page was refused.
- A business's automation emails, including booking confirmations, are now sent from its own verified default sender address instead of one installation-wide address. A business with no ready sender gets a failed automation run that says what to set up, and the booking or change still stands. Each automation delivery is claimed once and retried under the same delivery id, so two runs can no longer both send it. Inbox email re-checks its sender when it sends and no longer falls back to the installation's own key. Service notifications use the business default when a customer has no sender of their own. A business with exactly one ready address whose provider account is recorded was given it as its default.
- Email sending now has one place: Settings → Email sending shows whether the business can send and what to do next, its sending domains, its sender addresses and which one is the default. Communications keeps Inbox email, for which addresses receive into the Inbox, and links to Email sending. A domain is sent from only through the provider account recorded as holding it; domain setup now records that account, and a domain with none recorded must be checked again before it can send.
- Team invitations now say what happened to the email. "Invitation emailed" means GildOps' mail service accepted it; when it was not emailed the reason is shown, and the link is offered to share instead. Pending invitations show "Accepted for delivery", "Delivered", or "Failed" with its reason, rather than "Sending" or a bare "Not sent".
- Automation emails record what the provider later reports (delivered, delayed, bounced), send the same From on every retry, and are marked uncertain rather than resent once the provider's one-day duplicate protection has passed.
- Invitations now explain themselves end to end. The email names the business, the role, the address it is for and when it expires, and says a separate verification code follows for a new account. The link opens a page showing the same, carries the invitation through log in, sign-up and email verification (with the invited address filled in), and offers a signed-in wrong account a way to switch instead of an Accept button that would fail. A dead link says only that it can no longer be used.
- Email sending settings add where replies go (only the business's own addresses on verified domains), a test email to the manager's own address, and which addresses receive into the Inbox. Platform → Providers now reports GildOps' invitation email readiness as the API judges it, rather than from the web project's settings.
- Automation emails that may or may not have gone are shown as Uncertain instead of Failed, and a provider report about one settles it without sending it again. Received mail is read only through the account recorded for its domain. A pending invitation now shows the provider's report even when the provider's clock is behind GildOps'.
- The API now tolerates up to 30 seconds of clock difference with the sign-in service, so a request made right after signing in is no longer refused.

## 2026-10-19

- Workspace navigation has one approved contract (ADR-046, superseding ADR-006 and ADR-045's flat sidebar); product, architecture and UI documents now each own one part of it. A new `contract` CI job lists changes to protected contract paths (`.github/CODEOWNERS`) and requires a `Contract-Change:` rationale for them and a `Coverage-Change:` rationale for removed, skipped or newly mocked tests. It blocks merges only where branch protection requires it.

- North American phone numbers now display as `(416)555-0176` across Customers, Communications, public contact details and phone fields at rest. Editing, dialing, messaging and telephone links retain the original number.

- Marketing's Campaigns, Audiences, Leads and Performance, and AI's Agent activity and Evaluations, are now sidebar destinations. Workspace pages show their destinations in the header action row, drawn from the same navigation as the sidebar, instead of separate tab strips beneath the header. A read-only member is no longer shown links to AI configuration or Studio pages they cannot open. Header shortcuts yield to actions when the actual canvas cannot fit both, including long labels and docked panels; Finance collections keep one heading without repeating their global-header title.
- Dialer now groups Standard/Focus, panel visibility and calling actions in one toolbar. The console responds to available canvas width, keeps number entry bounded and places summary metrics under Call history. Shared collection headers publish one visible identity, popup draft return preserves caller choice and correct customer attribution, and the live-call timer hydrates consistently.
- Support's Cases, Queues, Service levels and Reports are now destinations in the workspace's sidebar beside Overview, and the duplicate tab strip and Views menu are gone. Configure opens a side panel with queues and service levels instead of a configuration landing page; existing configuration addresses still open directly. Service levels is an operating view for everyone with Support read access, and editing stays with Support configuration permission.

## 2026-10-18

- Restored workspace-level sidebar selection and contextual workspace destinations. Business vocabulary and page ordering now decorate the canonical navigation projection instead of flattening every workspace page into Home.
- Business words and navigation settings now group pages under their workspace, and moving a page only reorders it within that workspace.

- Simplified organization Home around attention, priorities, a tabbed Schedule and Business performance. Moved setup/workspace updates to shell notifications, unified create actions with Cmd/Ctrl+K, corrected configuration ownership and duplicate health messages, and reduced explanatory copy.

## [Unreleased]

### Business foundations ? 2026-10-17

- Signed inbound calls now execute the canonical routing resolver, including browser membership ringing, bounded fallback and business-authored end messages. Browser receiving is explicit in the persistent Dialer. Retries preserve call identity and round-robin choice while rechecking live human authority.
- Setup and General Settings share a versioned, organization-owned vocabulary/navigation profile. Authored headings, forms and breadcrumbs use the vocabulary resolver; the authorized business sidebar stays flat across destinations. Calendar defaults to This business and retains internal event provenance.
- Platform pages now live at `/platform` in their own guarded shared shell. Existing operating Membership and exact platform permissions remain enforced; former organization Platform URLs render the organization not-found page.
- Added a published-deployment voice receptionist adapter, business duration/budget controls, central voice-runtime assignment, signed session callbacks, atomic usage metering and restricted human fallback transfer. Unknown usage remains reserved; uncertain transfer effects do not retry automatically. Local implementation is separate from hosted or real-provider acceptance.
- Replaced the agent contract with the accepted short draft and corrected Calendar authorization/navigation regression tests.


- Customer discovery and GildOps subscription proposals now appear only for platform-authorized viewers in the configured operating organization. Communications has a Dialer at the existing `/calls` address, with real open call follow-ups, customer context, retained call history and a top-bar phone entry to the existing pop-out. Calling still requires current permission, entitlement and provider readiness; live-provider acceptance remains separate.

- Customer notification delivery is safer under failure: an expired worker lease can no longer complete a send, and a late provider answer settles the job instead of a resend; a signed delivery or bounce callback that arrives before acceptance is held privately and applied once acceptance is recorded; retries keep the provider account pinned at first claim, and a delivery that may already have been sent is shown as "Delivery uncertain" rather than failed when its account changes or its retry window ends; the scheduled worker now works to a bounded time budget. Not yet exercised against a hosted environment or the real provider.

- Platform Administration now opens inside GildOps' own organization instead of switching to a separate "GildOps Platform" identity: the context switcher keeps showing GildOps and lists organizations only. Staff with a platform permission get one private Administration row after the workspaces (Organizations, Product Registry, Integration Registry, Infrastructure, Reliability and Commercial administration, each filtered by its own permission), plus staff-only links from Finance to Commercial administration and from AI to AI Runtime. Routes and server guards are unchanged.

- GildOps' operating organization is now explicit platform configuration (`platform_settings.operating_organization_id`) instead of whichever organization holds the `gold_internal` Plan. Changing GildOps' Plan no longer changes which organization is GildOps, and giving the internal Plan to another organization no longer makes it GildOps. The migration backfills the one current internal-Plan holder and stops if there is more than one. Platform routes still require that organization, actual Membership and the live platform capability. The bootstrap designates the organization once and refuses any other; the `gold_internal` Plan remains as a non-billable entitlement.

- Customer service reviews now pin approved disclosure revisions, record attributable Portal approvals or change requests, and preserve final decisions. Change requests create canonical Support Cases; replacement/withdrawn material blocks stale responses. Approval is an operational acknowledgement with no signature, deployment or tenant-access authority.

- CRM service engagements now support private customer-update drafts, explicit approval/publication and withdrawal with immutable history. An opt-in Portal Services module and Managed Services template show only each customer's approved summaries; ended tenant relationships suspend deliverable presentations without changing tenant records or service invoices.

- Studio Portal now supports typed pages/navigation/module configuration, templates, shared branded previews, saved draft review, immutable publication/history/restore and entitlement-aware customer delivery. Published exposure guards Form/payment commands; managed and verified custom origins bind exchanges/pages/actions to PortalContext while preserving legacy links and separate session cookies. Services use the independent CRM disclosure approval boundary; typed Portal deliverables retain independent tenant authority.

- CRM Customer detail now manages durable Client/Tenant relationships and service engagements, with atomic proposal-handoff linkage, verified existing-tenant association, preserved lifecycle history, typed Website/Form/AI deployment/Automation deliverables and canonical Work references. Artifact selectors require independent tenant access; linking grants no Membership or implicit operational authority.

### Changed

- Appearance settings choose a visual style from one compact, keyboard-operable set of choices, and the single Preview is the only sample. The Preview no longer picks up the saved style's shadows and motion when a draft returns to Platform default with an override.
- Added persistent Help & Support, Settings, and independently authorized Platform controls; Account now owns identity and Sign out.
- Consolidated workspace configuration behind one contextual entry with responsive page sections. Communications, CRM, and Finance retain compatibility redirects; Work, Support, AI, and Studio retain their canonical domain ownership.
- Communications configuration reports channel-specific readiness blockers without treating provider configuration as proof of delivery.
- Work configuration separates choosing a work type, creating one, and editing one. Types list beside the selected type's tabs when there is room and drill in one level at a time when there is not; New type opens a focused drawer that asks only for a name and whether the work is scheduled, then lands on the new type's Workflow tab. Deep links (`?type=`, `?tab=`, `?new=1`) and the Work Configure rail keep working; the earlier `?tab=types` now opens General.


- Workspace navigation now enters a contextual sidebar with Overview, eligible operating destinations and Back to Workspaces, preserving canonical URLs and the persistent Organization shell.

### Imported application library and resource synchronization — 2026-10-11

- Connections now shows searchable, filtered application metadata from 36 imported open-source connector packages, with 64 reviewed reads and explicit deployment/authentication blockers. No integration-service account is required.
- API-key verification, Vault storage, single-use read jobs and existing agent/automation grants share the canonical connection and execution authorities.
- Selected Google/Microsoft folders, calendars and worksheets support persistent reconciliation, cursor recovery, synchronization controls and record previews. Completed worksheet snapshots feed the existing customer mapping/import flow; Library Sources uses the canonical resource list.
- Live vendor acceptance remains unverified without configured deployment secrets and authorized test accounts. Custom authentication, subscribed triggers, financial writes, calendar write-back, file-byte import and worksheet export remain unavailable.

### Connected tools: the asker's rights, approvals that finish, automations — 2026-10-11

- A native connected-app read now needs two things: the agent's grant and the asking member's own permission for that kind of data, so the agent cannot read more than its asker could. Approving a waiting request checks everything again at that moment, including the agent's reading limit and the requester's permission.
- A request a person approves later now reaches the conversation that asked: the agent receives the result (or the fact it was declined) at the start of its next turn, once, and nothing is kept afterwards.
- A rule can now "use a connected tool". It reads from a connected app under its own grant, through the same checks an agent meets; a refusal is recorded and not repeated, and only an unreachable app is retried. The rule records that the read worked; nothing yet uses what it read.
- The execution record's upkeep runs on the automation schedule, and the public plans list is read in pages so a large list can no longer hide plans.
- Still open: MCP tools are not offered to automations, MCP servers use a bearer token only, and an approved result arrives on the next turn rather than resuming the one that asked.

### Settings as one sidebar, a real business profile, and Help — 2026-10-10

- Settings no longer has a landing page or an Organization directory. Entering it swaps the sidebar for Back to app, a search box and three groups: Personal (Profile, Security & sign-in), Organization (General, Branding, Domains, Features) and Administration (Team & access, Connections, Plan & usage). Configuration a workspace owns, such as working hours, prices, stages and call routing, is configured in that workspace and found through Settings search. Old Settings addresses still work.
- Organization → General is now the business profile: name, optional legal name, industry, a structured primary address, general contact details, and the time zone and currency the location implies. The address is private to members and is never copied to the public profile. Setup shows the same form.
- Founding a business asks for its location and suggests the time zone and currency from it, for the founder to confirm or change. The location is stored in the same transaction as the business. A later change of location proposes new defaults and never applies them silently.
- The account menu now offers Settings, Help & documentation, Contact GildOps Support and Sign out. Help is a small searchable set of guides. Contact GildOps Support records a request from the operator to GildOps; it is not a Support case and gives GildOps no access to the business.
- Page titles are no longer printed twice (once in the top bar, once as a heading) on Settings and Help pages, and the last control on a long page now scrolls clear of the bottom edge.
- Known limits: suggestions come from a country and region table, not a geocoder, and cover Canada, the United States and Australia by region and about thirty other countries by country; there is no staff screen for reading support requests yet; Help and Contact appear only inside a business; a business accepted through Sales is not yet prefilled; existing businesses show an incomplete profile until it is filled in.

### Connected tools can be governed and used — 2026-10-10

- A business can add an MCP server (Settings → Connections → MCP servers), see the tools it offers, review and enable each one, and give the operator agent access to a tool. An MCP tool always waits for a person's approval, and a tool the server later changes comes back unreviewed and off.
- The eight connected apps now offer read operations (calendar events, files, contacts, deals, channels, zones and so on) that an administrator can give the operator agent one at a time, optionally limited to one item. Nothing is available until it is given; none of them changes anything in the app.
- Every use is recorded as who asked, which tool, the decision and the outcome. What was asked and what came back are not kept, and withdrawing access stops the next use immediately.
- Custom MCP addresses stay off on a deployment until it declares network egress controls (`GILDOPS_MCP_CUSTOM_ENDPOINTS`).
- Known limits: MCP servers use a bearer token only (no OAuth); automations hold grants in the database but no automation action can run a tool yet; an approved request runs when approved and is not returned to the conversation that asked; the retention job is not scheduled.

### Configuration and readiness convergence — 2026-10-10

- Each workspace's Configure control now reads its destinations from the configuration registry with the same entitlement and permission gate as Settings: one named link or a menu, never a button that opens an unrelated collection, and nothing for a member who may not configure. Communications, Support, Work, Finance, Automations, AI, Marketing and Studio offer their real configuration doors; CRM keeps its rail.
- Readiness has one vocabulary that keeps configuration, verification, provider state and the viewer's access apart. Setup progress separates required items from areas finished, and states that the latter includes optional ones. The Communications inbox is no longer "Available" merely because the member may open it, and an unpublished website is no longer "Setup needed".
- Launch blockers remain the database's authority; no schema change. Provider-health and fixture tests that depend on a clean local database are recorded in the completion report.

### Workspace visual convergence — 2026-10-09

- All nine workspaces and Home share one set of operational components for panels, metrics, status, empty states, view navigation, page headers and the Configure entry. Local panel, badge and tab implementations are removed, so an organization's brand and dark mode now reach every hub.
- Operator UI no longer contains hard-coded palette colours; interaction colour follows the organization accent and status colour is limited to platform-owned facts. Empty regions distinguish empty, not configured, unavailable and restricted. Studio lists a missing logo or introduction as a suggestion, not an exception.
- Verification baseline repaired: stale architecture contracts updated and genuine route-guard, layering and drawer defects fixed. Eight browser journeys and five database files that fail independently of this work are recorded in the completion report.

### Branding editor and theme foundation — 2026-10-09

- Branding is now a visual identity editor (logo, one brand colour with presets, typography with samples) beside a live preview that renders the shared controls in light, dark, workspace and customer views, at desktop and phone widths. Public profile and the public booking address moved to their own Settings destinations: Public profile and Domains.
- Shared links now use the brand's readable link colour, a chosen body font applies to inherited text, a font choice applies without an accent, and the dark-mode focus ring is visible. Brand roles never override error, warning or success colours.
- No schema change. Workspace-local hard-coded blue remains for the workspace convergence work; separate dark-background logos and concurrent-edit detection are not yet supported.

### Global Home operational dashboard — 2026-10-09

- Replace the starting Home with authorized projections across nine workspaces, exact exception counts, assigned priorities, local-day operations, period performance, activity and readiness.
- Keep creation and resolution in owning workflows, preserve the global Agent rail, and exclude private conversation content from Home. Separate stored currencies and expose unavailable sources honestly.
- Add guarded Studio metadata and canonical financial-total RPCs. Migrations are verified locally; hosted application and live provider verification remain release steps.

### Tenant AI agent operations ? 2026-10-08

- Replace the tenant AI starting page with agent collections, a draft/version workbench, deployment configuration, published website knowledge, governed tools, personal evaluations and real activity/allowance reporting.
- Connect published Operator Copilot configuration to the existing global Agent rail and shared runtime. Add contextual supervised drafting in Communications and summaries in Support.
- Add website conversation continuity and a Communications claim/reply/resolve workflow; restrict generated reply writes to the machine role and stop automated replies on handoff.
- Keep unsupported SMS/email/Support autonomous runtimes, Voice and Customer Portal explicitly unavailable; configuration never implies a verified channel integration.


### 2026-10-08

- Implemented the Support operating workspace: persistent Cases, queue ownership, priority, escalation, internal notes, resolution and explicit reopening, elapsed service levels, exact reports and private attributed history. Added shared contextual Case creation from CRM, Inbox, Calls and Work, six scoped capabilities, tenant-bound relationships and responsive Home/list/board/workbench/detail/configuration/report surfaces.

### Marketing operating workspace — 2026-10-08

- Added tenant-scoped campaigns, saved dynamic audiences, attributed acquisition inquiries and explicit canonical CRM handoff, with narrow Marketing capabilities and RLS.
- Replaced the Marketing placeholder with operational Home, Campaigns, Campaign detail, Audiences, Leads review and Performance routes.
- Connected tracked published Studio Form links to transactional, idempotent inquiry capture; retained revision/source history and existing untracked submissions.
- Added database journey and negative authorization coverage. Promotional broadcast delivery remains unavailable.

### Studio and shared page drawers — 2026-10-08

- Replace the sparse Studio Home with a contained website preview, factual website/form/response summaries, content and submission previews, publishing attention, creation shortcuts and public-surface configuration links. Preserve flat workspace navigation and canonical ownership.
- Unify contextual drawers around shared padded bodies, fixed headers/footers, body-only scrolling, Escape dismissal and focus return; remove repeated outer gutters from existing feature drawers. Add an isolated responsive website-template preview with mobile/tablet/desktop controls.
- Share responsive Website/Form editor panes, preserve compact editing state, add form-question duplication, local validation/confirmation testing and unsaved-change warnings. Forms exposes URL-backed search, publication filters, sorting and pagination; submission links retain the selected response.
- Add bounded response pages and read-only inspection of saved Form revisions with the existing manager authorization. Apply `20261022000058_studio_submission_pages.sql` and `20261022000059_studio_form_revision_inspection.sql` before deploying; database types are regenerated. Gate distribution links on publication, confirm archiving, and move legacy Catalogue/Plan drawer actions into fixed shell footers. Existing publishing/revision operations remain authoritative. No hosted data changes.

### Automations operating workspace — 2026-10-08

- Replace the minimal Home, Rules and Activity presentation with a contained operational dashboard, filtered collections, execution/delivery inspectors, and a linear visual Rule Builder. Retain legacy links, flat navigation and canonical execution authority.
- Add atomic condition/action editing, disabled-by-default UI authoring with deliberate activation, canonical readiness warnings, and message-template placeholder insertion with a sample-only preview.
- Add exact RLS-scoped execution aggregates and Organization-timezone trends through a forward-only migration. Preserve historical runs and snapshotted message content; per-action history and live provider verification remain outside the recorded telemetry.

### Work operating workspace ? 2026-10-08

- Replace the sparse Work Home with a contained operational dashboard using exact backlog counts, canonical daily commitments and resource availability, bounded previews and linked activity. Keep honest empty panels and opening-hours setup states.
- Add Dispatch with URL-backed queue filters, resource assignments/free windows, a contextual scheduling/feasibility inspector and actual Location map selection. Reuse the existing authorized mutation paths and refresh every affected operating surface.
- Add compact Work List/Board views with independent status reads and exact per-stage counts; reorganize Work configuration as a type workbench and expose Resource class/capability and day-availability filters. Preserve configured transitions, tenant boundaries and overlap prevention without a schema migration.

### Communications operating workspace — 2026-10-08

- Replace the sparse Communications Home with a dense operational dashboard: readiness strip, missed calls/unread/unassigned/wrap-up attention, bounded Inbox queue and canonical call history, Today/status/activity/insights rail. Search, date and queue filters operate on tenant-scoped records; counts are exact rather than preview lengths.
- Keep Calls, Inbox split view, Numbers and configuration as canonical destinations; remove the old CRM summary from Calls and expose handler/source columns. Reuse dialer, conversation assignment/read actions and call wrap-up; unavailable senders and calling connections cannot appear ready to send.
- Expand Communications configuration into visible sections. Restore saved ordered primary/fallback routing targets before allowing edits to save, retain route-to-route destinations, and expose routing preview with failure handling. No new persistence model or migration.

### Finance operating workspace — 2026-10-08

- Replace the sparse Finance Home with a contained financial dashboard: period-scoped recorded payments, current receivables and uninvoiced quotes, attention categories, due invoices, activity, aging and financial performance. Currency totals remain separate; unsupported reminders and processor outcomes are never implied.
- Add contextual Work pricing, invoice review/issue and payment-recording drawers, searchable paginated collections, a financial report destination and compact Services & Pricing management. Finance links open canonical Work financials directly.
- Add tenant-policy-preserving database read projections and permission-checked complete summaries. Invoice snapshots, one invoice per Work item and append-only payment corrections remain unchanged. A forward migration is required before deploying the new surfaces.

### Communications dialer pop-out — 2026-10-08

- Add a compact dialer window, informed by Next-Fund's keypad and calling presentation, from New call and the active call dock. It shares the existing telephone and call actions, preserves the number draft on return, and keeps live calls under control while moving between workspaces.
- Handle blocked pop-ups and window closure without hanging up; prevent the New call form from starting another call while one is active.

### Shared calendar foundation — 2026-10-07

- CRM Follow-ups and Work Schedule now share calendar navigation, date picker, workspace frame, week/day agenda and month grid. Domain filters, records and event actions remain contextual additions.

### Operational CRM — 2026-10-07

- Recompose CRM Home around attention, today, currency-safe forecast/pipeline and event-backed Opportunity conversion. Add Customer/Opportunity search and contextual creation.
- Add canonical CRM Follow-ups with collection, day/week/month calendar, Customer/Opportunity integration, inline completion, contextual editing and immutable activity evidence. Tenant-aware references and `follow_up.manage` enforce writes in PostgreSQL and server actions.
- Replace global pipeline paging with independent per-stage previews and exact stage totals. Mark Follow-ups and conversion implemented; correct the unsupported Customer-ownership catalogue claim.

### Workspace Homes — 2026-10-07

- Add authenticated Marketing, Support and tenant AI Homes with honest starting states and explanatory operating areas. All nine workspaces now have real Home destinations in the flat tenant sidebar, subject to existing eligibility rules.
- Use Megaphone for Marketing, Headset for Support and Bot for AI; retain Wrench for Work and the global Agent's Bot rail control. Tenant AI remains separate from Platform AI Runtime and provider credentials.

### CRM — 2026-10-07

- Add first-class Opportunities, collection/detail/pipeline views and a Customer Opportunities tab. Opportunity stages classify potential business as Open, Won or Lost while existing Customer stages remain the relationship lifecycle.
- CRM Home now summarizes canonical Opportunities with exact stage counts and separate currency values. Opportunity ownership uses Membership, permissions are separate from Customer editing, and events preserve historical stage meanings. No stages are seeded; unstaged remains separate from Open.

### Documentation

- Replace the legacy documentation sprawl with a canonical documentation set covering product, domain model, architecture, UI, security, data, integrations, testing, development, deployment, operations, roadmap and ADRs.
- Replace the old undated long-form changelog format with date-first release history.
- Make `CLAUDE.md` explicitly read-only for audits/reviews/plans unless repository mutation is requested, and require explicit permission for branch/commit/push/PR or external-system mutation.
- Add `docs/public-web.md` for the specialized public publishing/domain/external-session boundary instead of scattering those rules across generic architecture documents.
- Replace the empty ADR index with individual baseline decision records preserving rationale and rejected alternatives.

---

## [2026-10-13]

- Applied the approved Customer-import database repair with append-only staging,
  source-link matching, repeat-safe completion, 100-row commits and explicit
  readiness checks. Hosted verification confirmed field preservation, tenant
  authorization and prospect search in both the local and deployed CRM. No web
  or API deployment accompanied this database change.

## [2026-10-06]

### Settings and identity

- Restored Settings as five independent scopes: Organization, Account, Access, Connections and Plan & usage.
- Removed duplicate ownership paths that placed team/access concerns under Organization settings.
- Added real editable personal profile behavior rather than a read-only email-only surface.
- Added secure signed-in password-change behavior using current-password/fresh-proof requirements.
- Added secure email-change flow with identity verification and a dedicated callback.
- Corrected Account-menu and Settings navigation behavior and tightened route ownership tests.

### Navigation and Insights

- Retired the global Insights workspace presentation.
- Preserved deep reporting/Insights routes as cross-cutting analysis rather than a canonical operator workspace.
- Restored page-level Configure controls to the surfaces that legitimately own configuration.

### Studio

- Added organization-created multi-page websites.
- Website publishing now selects one whole site revision so navigation and pages cannot drift across versions.
- Added pages, sections, navigation, starters, revision history and restore-as-new-draft behavior.
- Public hostname routing now resolves published site pages rather than only a single fixed public surface.

### Connections and provider readiness

- Added organization-managed Secrets & credentials with write/replace/disable behavior and no plaintext readback.
- Added GitHub as an organization Connection with installation/repository scoping.
- Moved connector readiness authority to the API so the UI only offers Connect when the deployment can actually support it.
- Expanded Platform Provider readiness so catalogued, configured, verified, implemented, assigned and operational states are distinguishable.

### Scheduling

- Added travel-aware scheduling feasibility for mobile resources using prior/next work and routing time.
- Travel uncertainty remains explicit rather than being treated as zero.

---

## [2026-10-05]

### AI and usage

- AI requests now check Organization entitlement before model spend.
- AI token usage is normalized into the shared Usage Event model after provider-reported usage is known.
- Configuration drafting now uses the same platform runtime-assignment model as other AI capabilities.
- Removed model-provider credential ownership from the web application where runtime selection belongs to Platform infrastructure.

### Finance and Platform commercial boundaries

- Finance Home now represents the Organization's own customer-to-business financial operations.
- Plans & Add-ons and platform portfolio economics returned to Platform Administration.
- Organization Settings → Plan & usage remains the customer-facing GildOps subscription surface.
- Platform billing subscriptions now preserve recurring items, checkout reconciliation and provider-event ordering rather than flattening a subscription to one price.
- Payment requirement was corrected to be a Launch/readiness concern rather than an initial Setup prerequisite.

### Voice

- A business Call is now one canonical record even when multiple provider legs/participants exist.
- Call completion, transfer behavior and call duration now follow the business call lifecycle rather than the first provider leg to disconnect.
- Numbers now expose their operational purpose/capabilities/readiness separately from provider internals.
- Calls gained a unified list/detail workflow with filters, outcomes, participant history and controlled recording playback.

### Booking and portal

- Work types can define booking notice, same-day, future-window and cadence policy independently of appointment duration.
- Customers can reschedule or cancel their own bookings within Organization-configured policy.
- Portal links are exchanged into dedicated sessions instead of remaining bearer secrets in every action.
- Booking can include an Organization-authored Studio Form and commit booking + response atomically.

### Proposals

- Proposal links are exchanged into dedicated review sessions.
- Accept/decline behavior is single-decision and version-aware rather than relying on repeated bearer-link submission.

### Scheduling and resources

- Work Items can have multiple Resource assignments.
- Work Types can declare resource requirements by class/capability and quantity.
- Resources can define working hours and exceptions.
- Scheduling/booking can find complete feasible sets of resources rather than a single arbitrary Resource.
- Resource feasibility remains authoritative at commit time.

---

## [2026-10-04]

### Communications

- Added the multi-channel Communications foundation for email and messaging.
- Introduced one Inbox for email and SMS conversations rather than separate parallel message applications.
- Conversation state, assignment, unread handling and customer linking now use one Communications-owned lifecycle.
- Email became a first-class Communications channel with compose, reply, attachments, provider delivery state and inbound threading.

### SMS

- Carrier delivery vocabulary is normalized at the provider boundary.
- Late or duplicate provider callbacks no longer regress delivery state or duplicate usage.
- Inbound messages are metered and correlated without allowing tenant-controlled delivery-state forgery.

### Studio forms

- Added a Studio form builder, hosted public forms and reusable form templates.
- Form submissions remain pinned to the published form revision used by the respondent.
- Forms can be placed in websites/portal/public flows without creating separate copied form definitions.

### Mobile shell

- Phone navigation became:
  - Home
  - AI
  - Menu
- The phone header was reduced to context/location rather than recreating desktop chrome.
- Menu opens the same projected navigation hierarchy rather than a separate mobile information architecture.

### Work and resources

- Work Types now explicitly state whether they are scheduled.
- Bookable work implies scheduled work.
- Field/Schedule navigation now follows actual scheduled-work capability rather than always rendering.
- Resources gained classes and capabilities as canonical configuration rather than inferred behavior.

---

## [2026-10-03]

### Scheduling UI

- Rebuilt Schedule as a real operational surface with Day, Week and Month views.
- Fixed Day/Week layout so the schedule fills the available workspace and remains usable at tablet width.
- Customer detail gained shared Location/map projections without creating CRM-owned location copies.

### Platform billing

- Added commercial purchase quote/snapshot before checkout.
- Added multi-line platform subscription checkout.
- Added negotiated provider-price support while preserving what the Organization actually reviewed.
- Checkout now buys the resolved commercial package instead of reconstructing a different package later.

### Usage, cost and allowances

- Added infrastructure-cost taxonomy and Organization storage allowance support.
- Added customer-charge composition and richer provider-cost attribution.
- Added resolved allowance behavior and allowance-aware usage rating.
- Strengthened the commercial permission boundary around commercial configuration.

### Email provider infrastructure

- Added tenant sending-domain provisioning through Resend using provider-confirmed state.
- Provider verification is authoritative; tenant input cannot simply mark a sending domain verified.

---

## [2026-10-02]

### Provider correctness

- Closed Cloudflare/Resend integration correctness and security gaps.
- Strengthened review-step UI around provider-backed configuration.
- Tightened provider state so GildOps does not present unverified external state as complete.

---

## [2026-10-01]

### Canonical operator workspaces

- Adopted the current operator workspace taxonomy:
  - CRM
  - Communications
  - Marketing
  - Support
  - Finance
  - AI
  - Automations
  - Field
  - Studio
- Began separating workspace registration from whether a real navigation row should be visible.

### Frontend/application architecture

- Refactored the application layer and bulk-read composition.
- Split Python service responsibilities more deliberately.
- Made the Agent load lazily and expanded rendered-browser test coverage.
- Established canonical screen archetypes and reset the frontend component architecture away from the old container model.

### Platform Administration

- Consolidated Platform navigation into a coherent administrative scope.
- Added commercial/provider administration surfaces without treating Platform as a customer workspace.

### Providers and domains

- Added Cloudflare DNS connector foundations and automated Vercel domain bridging.
- Added Resend Platform Provider Account and invitation-delivery lifecycle.

### Settings

- Restored Settings as an explicit landing point and normalized route ownership.
- Continued separating Calls, CRM stages and Communications configuration according to domain ownership.

---

## [2026-09-30]

### Sales → provisioning handoff

- Accepted commercial proposals can hand off into creation of the prospect's own Organization.
- Added atomic/idempotent handoff behavior and canonical configuration snapshotting.
- Setup now knows why the Organization exists and can seed its first draft from the Sales/discovery handoff instead of asking for the same information again.
- Real entitlement resolution was connected to the provisioning/setup lifecycle.

### Application architecture

- Reset the frontend architecture contract and retired the old `components/containers` model.
- Reorganized shared UI around clearer primitives, application components, features and routed surfaces.
- Rehomed the public website under Studio with a real editing workbench.
- Normalized Organization Settings routes.

### Finance / commercial navigation

- Work during this period exposed the distinction between tenant Finance and platform Plans & Add-ons.
- Subsequent 2026-10-05 work completed the correction by placing platform commercial management back under Platform Administration.

---

## [2026-09-29]

### Discovery and commercial proposal journey

- Added structured discovery requirements rather than storing discovery as an untyped flat list.
- Added provenance and unresolved-requirement handling.
- Added recommendation of real catalogue Features from discovery.
- Added a preview of the prospect's proposed GildOps configuration using the canonical workspace model.
- Added versioned commercial proposals snapshotted from real catalogue pricing.
- Added prospect-facing proposal review and acceptance.

This established the reusable pre-tenant journey:

```text
Marketing / inquiry
↓
Discovery
↓
Requirements
↓
Recommended configuration
↓
Preview
↓
Commercial proposal
↓
Acceptance
↓
Provisioning handoff
```

---

## Earlier history

Repository history before **2026-09-29** remains available in Git.

The previous changelog contained thousands of lines of mostly undated implementation narrative. That material is intentionally **not** copied into this replacement file, because doing so would preserve the exact defect this changelog is meant to fix.

If an older release/event needs to be reconstructed:

1. inspect Git commit history;
2. identify the actual commit date;
3. identify the meaningful product change;
4. add a dated historical entry only if that history still provides operational/product value.

Do not paste old implementation diaries back into this file.

---

## Entry format

New entries should use:

```markdown
## [YYYY-MM-DD]

### Area

- Meaningful product/operator change.
- Important architecture/security/compatibility consequence.
- Known limitation when it materially affects the shipped behavior.
```

For work not yet shipped:

```markdown
## [Unreleased]

- Workspace navigation now enters a contextual sidebar with Overview, eligible operating destinations and Back to Workspaces, preserving canonical URLs and the persistent Organization shell.
```

When it ships, move the entry under the actual date.

---

## Changelog rules

### Include

- meaningful new product behavior;
- meaningful behavior change;
- security/authorization change;
- migration/compatibility change;
- operationally important provider/deployment change;
- architectural change visible to future operators/developers;
- removed/deprecated behavior with real consequence.

### Do not include

- every file edited;
- mechanical refactors with no meaningful consequence;
- test count diaries;
- code comments;
- speculative roadmap items;
- detailed rationale already owned by an ADR;
- enormous implementation walkthroughs.

A changelog entry should remain understandable without reading the diff.

Exact implementation history remains in Git.
