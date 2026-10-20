import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Page-location acceptance provisions its own disposable tenants, so it skips the demo global setup. */
export default defineConfig({ ...base, globalSetup: undefined, testMatch: ['**/page-location.spec.ts'] });
