import { rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { cleanupRun, readManifest } from './isolated-cleanup';

/**
 * Removes exactly what `isolated-setup.ts` recorded for this run — its business, its two accounts
 * and its plan — and the run's context and signed-in states. A failure throws, so the run fails
 * visibly, and the folder is kept so the next run's setup can retry it.
 */
export default async function isolatedTeardown(): Promise<void> {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
  const directory = process.env.E2E_FIXTURE_DIR;
  if (!directory) return;
  const manifest = readManifest(directory);
  if (manifest) await cleanupRun(manifest);
  rmSync(directory, { recursive: true, force: true });
}
