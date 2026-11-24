import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import isolatedSetup, { FIXTURE_DIR } from './isolated-setup';
import { createStudioFixture } from './studio-fixture';

/** The isolated business, then GildOps' website history as production holds it (`studio-fixture.ts`). */
export default async function studioSetup(config: FullConfig): Promise<void> {
  await isolatedSetup(config);
  const { organizationId } = JSON.parse(readFileSync(path.join(FIXTURE_DIR, '.demo-context.json'), 'utf8')) as { organizationId: string };
  const { userIds } = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'fixtures.json'), 'utf8')) as { userIds: string[] };
  await createStudioFixture(process.env.SUPABASE_DB_URL!, organizationId, userIds[0]!, FIXTURE_DIR);
}
