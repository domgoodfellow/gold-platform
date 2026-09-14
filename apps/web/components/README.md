# `components/`

Domain-agnostic UI shared by GOLD's frontend.

A component belongs here when it describes interface vocabulary rather than a product concept.
It may know about HTML, focus, responsive composition and visual roles; it must not know what a
customer, work item, automation, report, call or organization means.

| Folder | Owns |
|---|---|
| `controls/` | Buttons, inputs and accessible form composition |
| `containers/` | Cards, dialogs, shells, sections and headings |
| `display/` | Tables, definitions, badges, toolbars and widgets |
| `packages/ui` | Source-owned shadcn primitives, adapted to GOLD tokens before semantic use |
| `class-names.ts` | Shared class composition and the visible focus ring |

Caller count is evidence that an abstraction may be useful, not the ownership rule. A generic
primitive may begin with one proven caller when the interaction contract is already repeated in
that caller. A domain-aware component belongs in `features/` even when only one route renders it.

Nothing here reads the database or decides a business rule. Components receive values and events;
`lib/domain/` remains authoritative for validation and decisions.
