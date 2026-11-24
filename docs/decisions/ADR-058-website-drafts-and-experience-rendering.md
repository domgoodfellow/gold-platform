# ADR-058 — Website drafts know their base; every private surface draws a site through its experience

**Date:** 2026-11-24
**Status:** Accepted
**Extends:** ADR-032
**Supersedes:** None
**Superseded by:** None

## Context

ADR-032 made a website one immutable revision, published by moving one pointer, with restore copying an older revision forward. It did not say what a working draft was started from, and it assumed preview and public rendering share one renderer.

Production (2026-11-24) showed both gaps on GildOps' own site. A Studio draft (revision 4) was opened on 30 September from the homepage published then. Three migrations each published a newer homepage around it (5, 6, 7) without touching it. Nothing recorded the draft's base, so Studio could not tell it was older than the live site; nothing could discard it; restoring was refused while it existed; and publishing it would have replaced revision 7 with September's content without a word. The editor opened revision 4, while gildops.com served revision 7.

At the same time gildops.com is drawn by code-owned compositions (`MarketingHomepage` in the marketing frame), while the private preview and Dashboard drew the same revision in the business website frame (`SiteView`), and the editor canvas drew loose sections. Studio showed three different pictures of one revision, none of them the live one.

A third confusion sat underneath: one "revision number" and one "Published" status were being read as describing what visitors see, when the visible page is a content revision drawn by a particular build of the application, served by whichever deployment the hostname points at.

## Decision

1. **A draft records its base.** Starting a draft records the published revision at that moment (`base_revision_id`) and the revision it copied (`copied_from_revision_id`; a restore copies an older one). A working revision is **stale** when the site's published pointer has moved from its base. Drafts from before this decision recorded no base; they are stale when anything was published after they were opened. Existing rows are not rewritten.
2. **A draft can be discarded.** Discarding ends a draft or a revision in review without publishing it. The revision stays, read-only, with who discarded it and when (`discarded`), and an event records it with whether it was stale. Published content and history are untouched. A discarded revision can be restored like any other.
3. **Publishing never silently replaces newer content.** Publishing a stale revision is refused unless the person confirms replacing the newer published revision, by name; the publish event records that it did.
4. **Restoring is explicit.** Restore copies any revision other than the working and published ones forward into a new draft based on the current published revision. With a draft open it is refused, rather than quietly returning the open draft.
5. **Reading creates nothing.** Opening the editor, history, a preview or the Dashboard, and changing a preview's width, never create a revision.
6. **The database names the experience; one renderer chooses from it.** Each site is drawn as an experience: `gildops_marketing` for the site platform settings name as GildOps' own, `organization_website` for every other. `ExperienceView` is the only place the private surfaces (revision preview, Dashboard thumbnail, editor canvas, template previews) choose a renderer, and it uses the same components the live surfaces use (`MarketingFrame` with `MarketingHomepage`; `SiteView`). Authoring chrome wraps sections through a decorator and never changes them. Visual previews are isolated viewports at reference widths, so a page's own breakpoints and container queries apply.
7. **Content revision, source revision and deployment are separate facts.** Studio's numbered revisions are content. The Git commit a running build came from is the source revision (`VERCEL_GIT_COMMIT_SHA`, read by `lib/source-revision.ts`); the deployment a hostname is assigned to is provider state. Studio names the build that drew a preview of GildOps' site and never reports a revision as "live" on the strength of content alone.

## Consequences

- An old draft can no longer go live by accident, and an owner who finds one can discard it or start fresh from the published site.
- Studio shows GildOps' marketing site as visitors see it. Compositions, materials and lighting stay code-owned: what Studio edits is the content the compositions draw, not the compositions.
- Migrations that publish a revision still bypass Studio; the next draft opened, or any draft already open, shows as stale against what they published.
- Whether a hostname serves a given build is not knowable from inside the application. The GitHub connector reads a business's repositories; it is not GildOps' deployment authority (ADR-016).

## Rejected alternatives

- Deleting a discarded draft: loses the record of what someone authored and why it was abandoned.
- Rebasing a stale draft automatically onto the newer published revision: silently merges two authors' intentions in a typed but non-mergeable page model.
- Treating `SiteView` as the one renderer and adding marketing hooks to it: would put GildOps' look into every business's website.
- Representing deployment provenance through the GitHub Connection: a Connection is a business's authorized access, not GildOps' infrastructure (ADR-016); the deployment provider owns which commit serves which domain.

## Enforcement / current owners

- `docs/public-web.md` (Draft and published state, Restore, GildOps' own look, Draft preview)
- `docs/surfaces/studio.md` (Website previews and editors, Studio Home)
- `supabase/migrations/20261124000001_website_drafts_know_their_base.sql`
- `apps/web/tests/integration/database/public-site-drafts.test.ts`, `apps/web/tests/component/experience-view.test.tsx`, `apps/web/tests/architecture/static/public-site-schema.test.ts`, `apps/web/e2e/studio-stabilization.spec.ts`
