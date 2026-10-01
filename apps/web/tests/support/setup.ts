import { config } from 'dotenv';
// Extends `expect` with DOM matchers (`toBeInTheDocument`, `toHaveAttribute`, `toHaveFocus`, …)
// for every test, not only jsdom ones — the import only adds matchers, it touches no DOM itself,
// so a node-environment test that never uses them is unaffected.
import '@testing-library/jest-dom/vitest';

// Local test credentials come from the root .env.test, which `pnpm db:start` writes and
// .gitignore excludes. Nothing here reads production configuration.
config({ path: new URL('../../../../.env.test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
