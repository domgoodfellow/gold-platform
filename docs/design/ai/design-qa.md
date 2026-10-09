# Tenant AI design verification

Final result: pass for the rendered management, responsive editor and website handoff surfaces reviewed on 2026-10-09. This is a visual result, not certification of live model or carrier operation.

Targets: [supplied Home](home-reference.png), 1458 × 890 pixels, and [destination reference sheet](destinations.png), 1536 × 1024 pixels. Production-build Chromium captures use 1440 × 1000, 768 × 1000 and 390 × 1000 CSS viewports at device scale 1. Source and rendered captures were opened together in the same comparison inputs. Home comparisons account for the existing 288-pixel tenant navigation and compare the content hierarchy rather than treating that shell as part of the supplied image. Destination-sheet panels are conceptual references, not equal-scale pixel targets. Mobile comparisons assess responsive adaptation; the source has no phone target.

## Iterations

| Finding | Fix | Post-fix evidence |
|---|---|---|
| P2: attention content dominated the operating column | Compact attention rows in the contextual rail; bounded preview | [Desktop Home](evidence/home-1440.png) |
| P2: desktop table/grid widths crowded phone content | Explicit single-column grids, minimum-width constraints and agent cards | [Phone Home](evidence/home-390.png), [lower content](evidence/home-390-lower.png) |
| P2: open channel drawer squeezed the workbench between two inspectors | Hide the secondary readiness inspector while the channel drawer is open | [Voice configuration](evidence/voice-configuration.png) |
| Evidence gap: version screenshots preceded drawer appearance | Wait for the visible published-configuration heading before capture | [Phone version inspector](evidence/version-inspector-390.png) |

The final comparison found no remaining actionable P0/P1/P2 visual defects in the reviewed states. Focused comparisons inspected KPI/table density, drawer field spacing, instructional text, permission controls, semantic status labels and the phone version inspector. The reference's illustrative provider health, spend, sources and active-channel switches intentionally give way to canonical data and explicit unavailable states.

## Inspected states

Home at all three widths, lower phone content, [empty Home](evidence/empty-home-390.png), [creation drawer](evidence/new-agent.png), [overview](evidence/agent-overview.png), [instructions](evidence/instructions.png), [tool permissions](evidence/tools-permissions.png), [channels](evidence/channels.png), [published-site knowledge](evidence/agent-knowledge.png), [handoff policy](evidence/agent-handoff.png), [safe-preview service error](evidence/testing-result-state.png), versions, collection/activity/evaluation empty states and public widget handoff/staff reply were rendered and inspected. Browser assertions check page overflow at all widths, draft recovery and rail persistence across navigation.

The two browser journeys pass against the production build. The published tenant website records a visitor message, requests Communications follow-up when the answering service is absent, receives a claimed staff reply by polling and resolves the thread. [Visitor-visible staff reply](evidence/website-staff-reply.png) establishes this real flow. It does not establish AI-generated answers. Safe preview displayed the actual unavailable-service error; no successful model response or automated quality score is claimed. Voice activation is unavailable and blocked on the server.

Runtime follow-up requires configured answering-service and machine-channel credentials, a controlled live operator/website model test, and separate channel runtimes for autonomous SMS, email, Support, voice and portal deployments. Private Library ingestion and external MCP execution remain unavailable. No production data was seeded or deployment performed.
