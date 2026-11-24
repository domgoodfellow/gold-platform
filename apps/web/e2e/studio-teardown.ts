import isolatedTeardown from './isolated-teardown';
import { removeStudioFixture } from './studio-fixture';

export default async function studioTeardown(): Promise<void> {
  const directory = process.env.E2E_FIXTURE_DIR;
  if (directory) await removeStudioFixture(process.env.SUPABASE_DB_URL!, directory);
  await isolatedTeardown();
}
