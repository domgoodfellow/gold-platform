import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Isolated local Portal/operator accounts; no dependency on the demo seed.
export default defineConfig({ ...base, globalSetup: undefined, testMatch: '**/portal-composition.spec.ts', use: { ...base.use, ignoreHTTPSErrors: true, launchOptions: { args: ['--host-resolver-rules=MAP *.example.test 127.0.0.1', '--no-proxy-server'] } } });
