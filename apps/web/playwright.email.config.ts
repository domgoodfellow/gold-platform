import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Email production readiness through the real Web → API path: the spec starts the local API with
 * local-only settings and a fake Resend on a loopback port, and provisions its own disposable
 * businesses, so it skips the demo global setup.
 */
export default defineConfig({ ...base, globalSetup: undefined, testMatch: ['**/email-production.spec.ts'] });
