# ADR-042 — Studio customer Portal publication and host delivery

**Date:** 2026-10-14
**Status:** Accepted
**Supersedes:** None
**Superseded by:** None

Studio owns one Portal definition per organization. A coherent immutable revision contains typed settings, pages, navigation and stable module instances. Work, Invoices and offered Forms use their existing domain authorization and presenters. Services use CRM-owned approved disclosures with independent resource publication. Saving or restoring changes the draft; sending for review records the exact draft version; publishing requires organization management and current Portal entitlement and activation.

Existing invitations retain the legacy default until the first custom publication. Organizations without any Plan or Portal commercial history retain their existing activation-based default. Once commercial history exists it is authoritative, including expiry and revocation; published custom definitions always require current entitlement. Activation overrides remain authoritative. This compatibility exception does not authorize new publication.

Published exposure gates direct Form submissions and invoice payment initiation at the database boundary. It supplements customer ownership, current Form placement and revision checks and canonical Finance eligibility; it never replaces them. Automation artifact summaries retain the canonical membership-only read policy, whereas Studio configuration requires organization management. This is an intentional difference between domain read authorities.

PortalContext remains the sole external customer identity. Verified custom Portal hostnames resolve through the existing domain infrastructure. Managed organization origins serve Portal at /portal while retaining Website at their root. Each hosted Portal exchange, page and action resolves its hostname against the context organization. Application-origin links remain compatible. Exchanges remain same-origin and write a host-only gold-portal cookie scoped to /portal; operator, proposal and public Form identities remain separate. No DNS, TLS or provider deployment is provisioned by authoring.

Templates create independent drafts. Preview uses the shared presenters with explicitly labelled example records and canonical branding, without impersonating a customer. Page and module availability is visible to the author and is re-evaluated at runtime.
