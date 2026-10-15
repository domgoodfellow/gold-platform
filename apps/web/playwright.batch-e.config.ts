import { defineConfig } from '@playwright/test';
import base from './playwright.batch-b.config';
export default defineConfig({ ...base, testMatch: '**/service-notifications.spec.ts', use: { ...base.use, trace: 'off' } });
