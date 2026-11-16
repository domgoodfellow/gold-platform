# ADR-053 — Organization Activity is a global history utility

**Date:** 2026-11-16
**Status:** Accepted (owner-approved Shared Calendar & Global Activity work order)
**Supersedes:** None
**Superseded by:** None

## Context

The organization already has timeline readers, descriptions and actor attribution, while page-support Activity is intentionally local to a page. Opening organization history must not depend on whichever page happens to register an Activity panel. The broad event store is not a permission-safe client feed.

## Decision

The persistent organization header offers Activity after Team and Connections and before Agent. It opens a compact nonmodal responsive history panel, with no Platform entry. It has no unread count, delivery implication, read state or notification subscription.

The existing rail provider owns its open state and arbitration. Global Activity and the page panel retain independent state; only the selected one uses the secondary panel footprint. Global Activity uses the existing nonmodal overlay geometry at tablet/desktop widths and the phone sheet geometry. Activity and Agent use last-opened arbitration while preserving both states; ordinary page panels retain their existing wide coexistence with Agent. This avoids compressing unrelated dashboard containers. The global node is supplied by the organization shell, not a page-support registration. Closing Activity restores its trigger; hidden page drafts remain mounted.

Reads run on demand through the normal organization/service guard and the caller's database session. The existing timeline formatter and actor names are reused only after resolving actual membership, allowed event families and each referenced record's RLS visibility. Customer history requires contact viewing; tasks require their feature; financial snapshots require the existing Finance availability and report permission. Unsupported/private service, Agent and notification event families are omitted. Native Calendar events do not acquire fabricated activity writers.

The recent feed starts with 20 entries and may expand to 100, selecting from at most 500 candidate events with deterministic time/id order. Limits and failures are explicit. It claims neither a complete audit export nor push delivery.

## Consequences

Global and page Activity coexist without shared registration or competing panel state. A navigation or header link grants no authority. Canonical record links are returned only for records the actor can read. No event store, notification model, permission or billing entitlement is introduced.

## Rejected alternatives

Reusing the page-support Activity registration would make global history vary with page lifetime. Exposing raw events to a client or formatting their payloads before access checks could reveal restricted names or financial details. A notification bell or unread counter would imply a different product.

## Enforcement / current owners

`lib/domain/timeline/timeline.ts` owns the authorized organization read and existing descriptions; `features/timeline/` owns lazy loading and list presentation; the shared rail provider owns panel state. Organization shell composition supplies the control and content. Product, architecture, security, UI-system and shell surface specifications own current contracts. Real PostgreSQL and component/browser checks cover visibility, independent panels, focus and responsive behavior.
