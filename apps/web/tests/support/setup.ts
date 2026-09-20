import { config } from 'dotenv';

// Local test credentials come from the root .env.test, which `pnpm db:start` writes and
// .gitignore excludes. Nothing here reads production configuration.
config({ path: new URL('../../../../.env.test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
