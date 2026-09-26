import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string) => readFileSync(join(WEB, relative), 'utf8');

describe('the credential screens share one composition', () => {
  const layout = read('app/(auth)/layout.tsx');
  const form = read('app/(auth)/credentials-form.tsx');

  it('holds every screen in one bounded, bordered surface', () => {
    expect(layout).toMatch(/w-full max-w-sm/);
    expect(layout).toMatch(/border border-border/);
  });

  it('has no ambient background: the light pillar and its three.js dependency are gone', () => {
    expect(existsSync(join(WEB, 'components/auth/light-pillar.tsx'))).toBe(false);
    expect(existsSync(join(WEB, 'components/auth/auth-background.tsx'))).toBe(false);
    expect(layout).not.toMatch(/Background|Pillar/);
  });

  it('puts Forgot password in the Password label row, and only where the caller asks', () => {
    expect(form).toMatch(/recoveryHref\?: string/);
    expect(form).toMatch(/htmlFor="password">Password<[\s\S]*?Forgot password\?/);
    expect(read('app/(auth)/login/page.tsx')).toMatch(/recoveryHref="\/forgot-password"/);
    // Sign-up has nothing to recover, and the settings password change is already signed in.
    expect(read('app/(auth)/sign-up/page.tsx')).not.toMatch(/recoveryHref/);
    expect(read('app/settings/account/security/page.tsx')).not.toMatch(/recoveryHref/);
  });

  it('separates Google from the credential form and offers sign-up as a secondary action', () => {
    const login = read('app/(auth)/login/page.tsx');
    expect(login.indexOf('<AuthDivider')).toBeGreaterThan(login.indexOf('<CredentialsForm'));
    expect(login.indexOf('<GoogleAuthButton')).toBeGreaterThan(login.indexOf('<AuthDivider'));
    expect(login).toMatch(/href="\/sign-up"/);
    expect(read('app/(auth)/google-auth-button.tsx')).toMatch(/Continue with Google/);
    expect(read('app/(auth)/sign-up/page.tsx')).toMatch(/<GoogleAuthButton/);
    expect(read('app/(auth)/sign-up/page.tsx')).toMatch(/href="\/login"/);
  });

  it('keeps the autocomplete hints a password manager reads', () => {
    expect(form).toMatch(/autoComplete="email"/);
    expect(form).toMatch(/autoComplete=\{passwordAutoComplete\}/);
    expect(form).toMatch(/name="passwordConfirmation"[^>]*autoComplete="new-password"/);
    expect(read('app/(auth)/login/page.tsx')).toMatch(/passwordAutoComplete="current-password"/);
    expect(read('app/(auth)/sign-up/page.tsx')).toMatch(/passwordAutoComplete="new-password"/);
    expect(read('app/(auth)/reset-password/page.tsx')).toMatch(/passwordAutoComplete="new-password"/);
  });

  it('keeps the error alert and the pending state, and each screen its own action', () => {
    expect(form).toMatch(/<FormError>/);
    expect(form).toMatch(/disabled=\{pending\}/);
    const actions: Record<string, string> = {
      'login': 'logInAction',
      'sign-up': 'signUpAction',
      'forgot-password': 'forgotPasswordAction',
      'reset-password': 'resetPasswordAction',
    };
    for (const [route, action] of Object.entries(actions)) {
      expect(read(`app/(auth)/${route}/page.tsx`), route).toMatch(new RegExp(`action=\\{${action}\\}`));
      expect(read(`app/(auth)/${route}/page.tsx`), route).toMatch(/<AuthHeading/);
    }
  });
});
