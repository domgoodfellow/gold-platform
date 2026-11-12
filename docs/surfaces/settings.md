# Settings and Setup surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

## Settings → Features

Settings → Features is operational settings, grouped by product: only features this business can use (on, needing setup, or disabled) as compact rows with their Open, Set up and enable/disable actions. Every status comes from one classification, `featureOperationalState` (`lib/domain/catalogue/feature-operational-state.ts`), which Platform's organization screen also reads. Planned or partly built features are never listed, labelled Included or offered for activation, and the server refuses to switch them on or off; development status belongs to staff catalogue surfaces, which keep the Planned and Partial distinction. What the plan does not include is not listed either: one line counts it and links to Plan & usage, where purchasable upgrades belong. Status filters with counts and search narrow the list in place. A setup reason shared by several products is said once for the page with the features it affects; one product's own reason is said once for that product.

## Settings UI

Settings reinforces ownership through its grouping, not through a landing page. See A5 and A6 in [docs/ui-system.md](../ui-system.md#a5--settings-context).

Every group on a Settings page is a shared card: `CardSection` (`components/surfaces/card.tsx`) for a titled group, or `Card` directly where the heading row carries more than a title and actions. A Settings page does not use the ruled `Section` or a hand-built bordered box for a group, because only the shared card receives the Appearance preset, shape and density. Collection pages (Members, Invitations, Roles, Secrets & credentials) show their table directly on the page. A notice uses the shared `Alert`; a search and filter row uses the shared `Toolbar`.

### Organization → General

General is the business profile, one form with four sections: business identity (name, optional legal name, optional industry), primary business address, business contact, and Regional settings (time zone and trading currency). The same form is rendered in Setup and writes through the same action. Regional settings always shows the stored time zone and currency when editing, including when no country is set; a country only offers a suggestion, and a stored currency is never replaced by one. Customer payments (`settings/payments`: trading currency read-only with a link to General, manual recording, card collection) and Words & navigation (`settings/terminology`: the versioned business profile) are separate Settings pages.

The address is private to members (`organization_identity`) and is never copied to the public profile; publishing an address is the public profile's own field. A location change proposes a time zone and currency and applies neither until the person accepts it.

Organization setup uses an adaptive step navigation, a focused current-step panel and observed
readiness/launch support panel. Desktop supports three columns, tablet stacks readiness below the
current task, and phone uses contained horizontally scrollable step navigation. Continue changes the
step URL only; completion is always derived from saved domain records. Review lists required,
recommended and optional areas and offers only authorized owning destinations.

Proposal review is a dedicated workbench with independent operations, finance, people, data,
automation, presence and feature views. Switching views retains edits. Save and Apply are separate;
unsaved changes disable Apply and protect browser unload. Apply and launch use deliberate confirmation
dialogs. A failed application reports partial state; an interrupted application asks for inspection
before any new remainder draft. Roles use a scrolling capability body with a fixed action footer.

Organization Settings does not contain:

- Team/Members;
- personal Profile;
- Connections;
- Plan & usage;
- workspace-owned configuration (work types, working hours, price book, stages, call routing, agents, automation rules, website).

---

### Account

Account is person-owned.

Its local navigation should use the same shared sibling-view grammar as other scope navigation.

Do not maintain a one-off tab implementation solely for Account.

---

### Access

Access owns four Settings destinations, each its own entry in the sidebar's Access group. There is no tab strip repeating them.

```text
Members               settings/access/members
Invitations           settings/access/invitations
Roles & permissions   settings/access/roles
Access history        settings/access/history
```

“Team” may appear in descriptive copy if useful, but **Access** is the scope owner. All four are offered to a member who holds `role.manage`.

A member can only give permissions they hold themselves (docs/security.md). The role page therefore prevents adding a permission the person editing does not hold and says so in one line; existing permissions may still be removed. Members disables roles that hold more than the manager does; Add member offers only roles within reach. The database refuses the rest whatever the screen shows.

A new role may start from a role suggested for this kind of business. Suggestions come only from the published industry templates (`listRoleSuggestions`): the template the business started from, and any whose name or category is the industry given in General. They are listed first under Start from, named with the template they come from, and fill the name when it is empty. A business with no matching template sees only the general starting points. Nothing is created until the owner saves.

Access history is read-only: when, who, and what changed, for roles, members' roles and invitations, newest first, with Older changes and Newer changes links to browse the full history. Renewing an invitation requires the same permissions as sending a new one; revocation remains available to role managers. It reads the business's event log (`listAccessChanges`) and shows sentences, never event codes.

Members: a manager changes one person's role in the row. Choosing a role only proposes it; the change is made from a confirmation that names the person and both roles, and a toast confirms it. A refusal (for example leaving nobody able to manage roles) returns the row to the stored role and says why.

Roles & permissions: the list shows each role's name, how many members hold it and its permission count. A role is created (`roles/new`) and edited (`roles/[roleId]`) on its own page, not in a drawer. The page has the role's name, its permissions grouped by area with search, a count per group and Select all, the members who hold it, and Delete role. Sensitive permissions (`SENSITIVE_CAPABILITIES` in `lib/domain/tenancy/capabilities.ts`) are marked in words. Before saving an edit, the page says how many permissions the save adds and removes and for how many people. Unsaved changes are protected when leaving; a save is confirmed by a toast. A new role may start from a template, which only fills the checklist.

A role can be deleted only when no member holds it and no open invitation names it (`public.delete_role`). The page offers Delete only for a role nobody holds, behind a confirmation; otherwise it says how many people must be moved first.

---

### Connections

Connections owns external-system relationships: accounts the business itself has connected or authorised, and the credentials it has given GildOps to use. The services GildOps runs for every business (its calling, email and AI accounts, their credentials, provisioning and health) are administered only in Platform and appear nowhere in organization Settings (ADR-016). What a business was given from them, such as its phone number or sending domain, is set up in the feature that uses it. A test (`settings-route-contract.test.ts`) fails if organization Settings imports provider-administration code.

Its local navigation must reflect one explicit canonical set of real views.

Do not allow type definitions, comments and rendered tabs to describe different view sets.


## Words & navigation and General Settings

`CONFIG_TARGETS` and `WORKSPACE_CONFIGURE` retain canonical configuration ownership and authorization. Relevant operational pages link to their configuration roots; entering a workspace shows its own eligible destinations and Configuration, with Home returning to the organization-level directory. Configuration has no landing pages; the sidebar group and the Home's Configure control list its concerns directly. Settings → Words & navigation hosts the versioned business words/navigation editor, as two shared cards (Record names, Workspace pages) with one save; it does not fold that independent save into business identity.
General Settings is one form, saved once, whose Business identity, Primary business address,
Business contact and Regional settings groups are separate shared cards beneath the existing Settings sidebar; it has no
section navigation. Settings groups use shared surfaces so Appearance shape, density and
elevation reach them. Resolved links use
text labels, hover, selected and focus roles without a repeated generic icon. Page loading uses the
existing organization boundary; missing or unauthorized concerns resolve to not-found before data
reads. No empty configuration root is offered. `WorkspaceConfigure` remains a shortcut to each root.
