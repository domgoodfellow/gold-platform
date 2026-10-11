# ADR-041 — Import open-source connector packages

**Date:** 2026-10-11
**Status:** Accepted
**Supersedes:** None
**Superseded by:** None

## Context

The application catalogue must expand without hand-written adapters for every vendor. The user explicitly rejected integration services that require an additional vendor account. Existing tenant connections, Vault credentials, grants, RLS and execution auditing remain canonical.

## Decision

Import pinned Activepieces community connector packages into `apps/api`. Generate catalogue metadata, fixed module loaders and the web projection from installed packages. A Node function in the existing API deployment executes an explicit whitelist of reviewed read/search actions. Python owns caller authorization, OAuth refresh and command orchestration; Postgres owns tenant boundaries and execution admission. The Node function claims a single-use, expiring job before obtaining its credential.

This extends ADR-027's API deployment with a Node function; it does not move domain authority into connector packages. GildOps does not run or connect to an Activepieces service. Vendor OAuth registrations and API credentials are still required.

## Consequences

Discovery is available when the runtime is unconfigured. Installed does not imply connectable, authorized, or synchronized. Unreviewed writes, custom authentication forms and triggers remain unavailable. Adding a package requires regeneration, review and a forward metadata migration. Dependency updates are explicit and checked for metadata drift.

Selected Google and Microsoft resources synchronize into tenant-owned resource records. Provider change tokens or delta links support Drive and Calendar; Sheets and Excel use bounded snapshots with unique stable row keys. Metadata synchronization does not copy file bytes or create CRM/Finance/scheduling domain records automatically.

## Rejected alternatives

Pipedream, hosted Nango and Merge require an additional integration-service account and conflict with the revised instruction. Importing arbitrary caller-selected npm modules or enabling all package actions would bypass GildOps capability review. A separate automation platform would duplicate canonical connections and execution authority.

## Enforcement / current owners

`apps/api/library/policy.mjs` owns reviewed actions. `generate.mjs` derives metadata; `runtime.mjs` and `api/library_runtime.mjs` constrain execution. `app/connectors/__init__.py` owns deployment configuration. Database functions and RLS enforce admission, single-use jobs and resource isolation. `docs/integrations.md`, `docs/security.md`, `docs/architecture.md`, `docs/deployment.md` and `docs/testing.md` describe current contracts.
