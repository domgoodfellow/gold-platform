import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Team invitations and Email sending settings acceptance: disposable local businesses, a stand-in
 * for apps/api's invitation email on the local `GOLD_API_URL`, and the local mail catcher. It
 * provisions its own fixtures, so it skips the demo global setup.
 */
export default defineConfig({ ...base, globalSetup: undefined, testMatch: ['**/team-invitations.spec.ts'] });
