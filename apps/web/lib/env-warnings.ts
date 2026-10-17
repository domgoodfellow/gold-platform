/**
 * Partial configuration none of the adapter registries can see for themselves.
 *
 * Every `lib/adapters/*\/registry.ts` already treats any missing value in its own group as the
 * whole capability being off — correct, and not what this checks. What a registry cannot
 * catch is a group where *some* values are set and others are not: `STRIPE_SECRET_KEY` without
 * `STRIPE_CONNECT_CLIENT_ID` doesn't fail loudly, it just returns `null` from
 * `payments/registry.ts` exactly as if nothing were set at all — an operator who set one and
 * forgot the other sees "unavailable" with no hint why. Advisory only: nothing here throws.
 */
export function environmentWarnings(): string[] {
  const warnings: string[] = [];

  const pair = (a: string, b: string) => {
    const va = process.env[a];
    const vb = process.env[b];
    if (Boolean(va) !== Boolean(vb)) {
      const [set, missing] = va ? [a, b] : [b, a];
      warnings.push(`${set} is set but ${missing} is not — both are required together.`);
    }
  };

  pair('STRIPE_SECRET_KEY', 'STRIPE_CONNECT_CLIENT_ID');
  pair('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN');

  const browserCallingVars = ['TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_TWIML_APP_SID'];
  const browserCallingSet = browserCallingVars.filter((name) => process.env[name]);
  if (browserCallingSet.length > 0 && browserCallingSet.length < browserCallingVars.length) {
    const missing = browserCallingVars.filter((name) => !process.env[name]);
    warnings.push(
      `${browserCallingSet.join(', ')} set without ${missing.join(', ')} — browser calling needs all three of ${browserCallingVars.join(', ')}.`,
    );
  }

  return warnings;
}
