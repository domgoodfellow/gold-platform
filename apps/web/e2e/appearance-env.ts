import { config } from 'dotenv';

// Load local fixtures before importing domain helpers with module-level configuration.
config({ path: '../../.env.test', quiet: true });
