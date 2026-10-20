import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Workspace navigation acceptance provisions its own disposable tenants, so it skips the demo global setup. */
export default defineConfig({ ...base, globalSetup: undefined, testMatch: ['**/workspace-navigation.spec.ts'] });
