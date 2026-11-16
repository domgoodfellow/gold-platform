# ADR-052 ? Calendar is a shared organization destination

**Date:** 2026-11-16
**Status:** Accepted (owner-approved Shared Calendar & Global Activity work order)
**Supersedes:** ADR-046 point 1 shared-destination list; ADR-050 point 2 Calendar placement only
**Superseded by:** None

## Context

The workspace-local Calendar was difficult to discover outside CRM or Work. The renderer already combines native events, CRM tasks and scheduled Work. The completed CRM Calendar branch adds a useful bounded Dashboard agenda; this work builds on that committed revision instead of replacing that preview.

## Decision

Calendar is one shared destination at `/organizations/{organizationId}/calendar`, beside Home, Search and Library. It defaults to the authorized organization's events and retains date, Day/Week/Month view, originating workspace and source filters in the URL. Workspace Calendar addresses redirect with applicable query intent preserved. Contextual links use the shared destination with a workspace filter; no workspace owns a second full Calendar.

Native events retain their existing organization membership read/create rights, creator-or-manager edit/cancel rights, required workspace provenance and immutable attribution. New-event forms explicitly select a workspace when no context is supplied. Aggregation resolves the actual organization member and feature availability; canonical source reads and RLS continue to govern records and related contact details.

Work's Schedule remains the authority for resource commitments, availability and feasibility. Calendar stores no copy of Work or CRM tasks. ADR-050's prohibition on a Calendar shortcut in the persistent organization header remains unchanged.

## Consequences

The CRM Dashboard agenda remains, linking to the shared CRM-filtered Calendar. Shared navigation does not flatten entered-workspace navigation or remove explicit Dashboard destinations. Native events remain organization-shared; workspace provenance is not a private-event access rule.

## Rejected alternatives

A separate renderer, event table or scheduling model would duplicate existing authorities. Automatically assigning unfiltered new events to CRM would invent provenance.

## Enforcement / current owners

`lib/navigation.ts`, `lib/shell.ts`, `lib/application/calendar/`, `features/calendar/`, native event domain commands and RLS. Canonical specifications: product, domain-model, architecture, ui-system and the shell/CRM/Work surface specifications. Focused navigation, URL, database and browser checks enforce this decision.
