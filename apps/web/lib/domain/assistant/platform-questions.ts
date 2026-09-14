/**
 * Platform scope's own answering capability — deliberately separate from
 * `lib/domain/assistant/questions.ts`'s tenant-scoped `canAnswerQuestions`/`askQuestion`/
 * `agent_runs` (rule 13 of the shell/context correction: Platform Agent must never secretly run
 * "inside" a tenant, including GOLD's own).
 *
 * **Honest, not stubbed.** `apps/api`'s one answering endpoint (`/ai/ask`) is organization-scoped
 * — it takes an `organization_id`, runs tenant tools under the caller's own RLS, and there is
 * currently no platform-scoped counterpart reading `platform_catalog_*`, `organizations`,
 * `usage_events`, `platform_provider_*` and the rest under a platform-staff-checked path. Wiring
 * Platform Agent to the tenant endpoint would mean picking a fake organization to answer through
 * — the exact thing rule 13 forbids. So this returns `false`, truthfully, until that endpoint
 * exists; `PlatformAgentRail` reads it the same way `TenantAgentRail` reads
 * `canAnswerQuestions`, and shows the real "Agent unavailable" surface rather than a working
 * composer with nothing behind it (D31: a switch with no route to its inputs looks finished and
 * does nothing).
 */
export async function canAnswerPlatformQuestions(): Promise<boolean> {
  return false;
}
