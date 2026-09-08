# `components/`

The design system, and nothing that knows what a business is.

Everything here is shared by more than one route and extracted at its third caller (D23). The
sub-folders are not a taxonomy invented for this directory — they are the sections
`docs/ui-spec.md` already organises the interface into, so the file you want is under the heading
you would have looked it up by.

| Folder | What is in it | Spec |
|---|---|---|
| `controls/` | things a person operates: `Button`, `ButtonLink`, the inputs, the labels, `OptionalSelect` | §4 |
| `containers/` | the page's own furniture: `Card`, `Disclosure`, `Section`, the headings, `DividedList`, `EmptyState`, `AppShell` and the sidebar rows it draws | §5 |
| `display/` | values you read rather than edit: `DataTable`, `Badge`, `DefinitionList`, `Toolbar`, and the dashboard `Widget` | §5a, §7 |
| `custom-fields/` | rendering and collecting a tenant's own fields | — |
| `class-names.ts` | `cx`, used by all three | §4 |

**`custom-fields/` is the one folder that is not a spec section, and it is the interesting
case.** Those two files know what a `FieldDefinition` is, which the rest of this directory does
not — but they serve one surface, and `features/README.md` sets the bar for that directory at a
*second* surface. So they are shared components with domain knowledge, which is a real category
and belongs here rather than in a directory whose rule they do not meet.

**What left this directory, and why.** `brand-style` and `locale-fields` each turned out to serve
two surfaces and moved to `features/`. `credentials-form` and `org-shell` serve exactly one, so
they sit beside the routes that render them — a shared directory is for things more than one
route needs, and putting a single surface's chrome in it makes the directory mean less.

**Nothing here reads the database or decides anything.** Rules are in `lib/domain`, and a control
that took a `Db` would be a screen deciding something, which is the first rule in `CLAUDE.md`.
