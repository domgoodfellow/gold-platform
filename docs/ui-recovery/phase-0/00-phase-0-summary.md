# UI Recovery — Phase 0 status

Baseline repository: `domgoodfellow/gold-platform`  
Branch: `ui-recovery-phase-0`  
Source baseline: `main@2a5fcd2`

## Completed evidence

- Current-main anchor established after the latest Settings/security corrections.
- Exhaustive route inventory generated: **161 routed page surfaces**.
- Scope classification generated.
- Shared application component inventory generated: **52 files**.
- Source-owned `@gold/ui` primitive inventory generated.
- Initial rule audit produced with explicit canonical/stale/unimplemented classifications.
- Canonical surface archetypes defined as migration targets.
- Migration dependency map defined.
- Existing visual infrastructure inspected.

## Confirmed gap

The current Playwright visual suite is intentionally representative, not exhaustive. The existing standalone Platform visual script also navigates legacy `/platform/**` URLs. Phase 0 therefore needs a separate exhaustive audit harness that derives canonical routes/demo identifiers and records failures instead of treating every screenshot as a regression baseline.

## Current route counts

- AUTH: 4
- PUBLIC_CUSTOMER: 14
- PUBLIC_MARKETING: 11
- PREVIEW: 1
- ORGANIZATION: 94
- PLATFORM: 33
- PLATFORM_COMPAT: 1
- PERSONAL: 3

## Next executable outputs

1. static inconsistency scanner over every page/shared component;
2. exhaustive screenshot manifest with resolvers for dynamic routes;
3. Playwright audit runner that captures desktop/tablet/phone as applicable, console errors and failed requests;
4. generated HTML gallery/contact sheet;
5. measured pattern report feeding migration priority.

No broad UI refactor belongs in Phase 0.
