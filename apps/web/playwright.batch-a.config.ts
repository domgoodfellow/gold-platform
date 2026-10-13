import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// These journeys create isolated local accounts/tenants and do not depend on demo seed data.
export default defineConfig({ ...base, globalSetup: undefined, testMatch: '**/service-engagements.spec.ts' });
