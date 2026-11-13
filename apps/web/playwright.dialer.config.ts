import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, globalSetup: undefined, testMatch: ['**/dialer-workspace.spec.ts', '**/dialer-console.spec.ts', '**/contact-access.spec.ts'] });
