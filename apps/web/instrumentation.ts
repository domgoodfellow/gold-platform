/**
 * Next's own once-per-server-instance hook — the closest thing this runtime has to the boot
 * moment `apps/api/dev.py` prints warnings at. Advisory only: this never throws, so a
 * misconfigured deployment still starts (D31); it only makes a silent partial configuration
 * visible in the deployment's own logs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { environmentWarnings } = await import('@/lib/env-warnings');
  for (const warning of environmentWarnings()) {
    console.warn(`[env] ${warning}`);
  }
}
