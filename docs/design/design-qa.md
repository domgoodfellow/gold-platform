# Support design QA

final result: passed

Source visual truth: the supplied Support Home image in the task (1672 × 941) and `docs/design/support/destinations.png` (1536 × 1024, seven generated destination frames). The interaction contract is `docs/design/support/interaction-matrix.md`. Generated example copy, states and metrics are illustrative; the user's canonical lifecycle and real database results control implementation.

Implementation evidence: `apps/web/test-results/support/`, captured in authenticated local Chromium at deviceScaleFactor 1. Desktop is 1440 × 1050 CSS/pixel dimensions; Home also uses 768 × 1050 and 390 × 1050; queue mobile uses 390 × 844. Fixtures belong only to the local Supabase database. Empty, populated, overdue, active, resolved, read-only, drawer and contextual-origin states are captured.

Combined source/implementation evidence is saved in `docs/design/support/comparison-{cases,detail,new-case,resolve,queues,service-levels,reports}.png`. Source contact-sheet frames are cropped by CSS and normalized to 760 px wide beside 760 px wide browser screenshots. These compare composition and hierarchy, not identical pixels or identical example record counts. The generated service-level frame includes its edit form; the browser's table and `policy-drawer.png` cover those states separately. Original-size browser captures were additionally inspected for readable typography, field labels, badges and dense table cells; scaling in the combined boards alone is insufficient for those judgments.

## Findings and fixes

1. **P1, initial Home layout:** missing Tailwind source registration removed the intended desktop rail and grid. Registered `features/support` in the existing stylesheet source list. Final `home-1440.png` and `home-1440-lower.png` show the main/rail composition, four KPIs, breach banner, active collection, workload, performance and resources. Narrow captures show stacked panels without document overflow.
2. **P2, forms:** implicit select labels included option text and prevented exact accessible-name selection. Added explicit accessible names through the shared Support Field. Queue, policy, Case, assignment and resolution drawers now complete in the browser journey.
3. **P2, queue workbench:** the initial inspector sat below the collection at desktop. Final `comparison-queues.png` shows selector, collection and inspector side by side; `queue-mobile.png` and its lower capture show stacked access on a phone.
4. **P2, row actions:** native expanding details enlarged table rows. Replaced them with the existing shared Popover and library icon; opening a Case drawer from the popover is verified. Closing a Case uses the shared confirmation dialog.
5. **P1, contextual creation:** a generic drawer refresh competed with the navigation to the created Case. Creation now navigates once; the authenticated Inbox journey verifies the resulting canonical Case and independent conversation state.

## Fidelity review

- **Typography:** existing Geist sans and shell tokens retained. Compact 11–12 px table text, 14 px panel headings and 24 px page headings provide the reference's operational hierarchy. Original captures confirm readable state labels, wrapped customer/queue names and truncated secondary Case titles.
- **Spacing and layout:** thin bordered white panels, consistent edges, compact rows, four KPI cards, main/context composition, wide timeline/narrow inspector and right-hand form rail follow the references. The written brief adds a main attention panel and local destination/date controls, so Home contains more vertically scrollable content than the original screenshot. Existing shell scroll ownership and phone navigation remain intact.
- **Colors and tokens:** blue actions and selected destinations; rose urgency/overdue states; amber high/waiting states; green resolution; muted secondary information. Borders and backgrounds use existing app tokens.
- **Assets:** this is an operational UI with no photo or illustration requirement. Existing shell identity and Lucide icons are retained; no reference artwork is approximated with decorative custom drawing. Generated destination images are design references, never rasterized product UI.
- **Copy and content:** real Case identifiers, Customers, queues, owners, dates, deadlines and attributed events replace illustrative content. Unavailable first-response/business-hours metrics are stated explicitly. No sample trend percentages, satisfaction, presence or customer messaging controls are presented as working features.

Intentional adaptations: retain the canonical light, flat workspace sidebar rather than the contact sheet's dark nested sidebar; use the required New/Open/Waiting/Resolved/Closed lifecycle; retain the existing nonmodal PageDrawer; use real daily counts and meters rather than invented smooth trend lines. Queue configuration uses focused drawers. Resolution requires one meaningful internal summary and does not imply sending a customer reply.

## Verification and residual gaps

The focused database and integration gate passed 191 tests across seven files, including tenant isolation, private history, independent authorities, concurrent numbering, independent board bounds, policy snapshots, CRM/Work contracts and flat navigation. The final Support-only database rerun passed all six tests after tightening routing and Today counting. The final Support browser journey passed, exercising configuration, creation, internal note, assignment, priority, escalation, resolution, close/reopen, related Work navigation, Inbox-origin Case creation with queue/member/SLA/private note, read-only controls and responsive screenshots. Console page errors are asserted empty. Typecheck and production build passed; lint passed with one existing unused-variable warning in `travel-feasibility.test.ts`. No hosted production or carrier delivery was exercised.

The Support migration was applied to the local database and recorded as applied after verification. Earlier unrelated local migration-history drift was left untouched; this is not evidence of a clean full-database replay or a hosted rollout.

No actionable P0/P1/P2 visual findings remain for the implemented contract. P3 follow-up: further condense Home attention previews if operators prefer more active Cases above the fold. The existing application font and shell geometry are intentionally preserved.

Implementation checklist: source registration fixed; accessible labels fixed; inspector placement fixed; popover/drawer and confirmation interactions verified; empty/populated/mobile/read-only captures inspected; canonical docs updated; no unsupported metrics added.
