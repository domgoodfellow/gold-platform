import { pendingInvitation } from '@/lib/route/pending-invitation';
import { developmentSupabaseTarget } from '@/lib/db/server';
import { BUSINESSES, DEMO_PASSWORD } from '@/scripts/demo/businesses';
import { AuthDivider, AuthHeading, AuthSecondaryAction } from '../auth-parts';
import { CredentialsForm, DemoAccountButtons } from '../credentials-form';
import { GoogleAuthButton } from '../google-auth-button';
import { logInAction } from './actions';

export const metadata = { title: 'Log in · GildOps' };

export default async function LogInPage() {
  const invitation = await pendingInvitation();
  return (
    <>
      <AuthHeading title="Log in">
        {invitation ? `Log in with ${invitation.email} to accept your invitation to ${invitation.businessName}.` : null}
      </AuthHeading>

      <CredentialsForm
        action={logInAction}
        fields="email-and-password"
        submitLabel="Log in"
        pendingLabel="Logging in…"
        passwordAutoComplete="current-password"
        recoveryHref="/forgot-password"
        defaultEmail={invitation?.email}
      />

      <AuthDivider />
      <GoogleAuthButton />

      <DemoSignIn />

      <AuthSecondaryAction prompt="Don’t have an account?" href="/sign-up">
        Create an account
      </AuthSecondaryAction>
    </>
  );
}

/**
 * One-click sign-in as each `pnpm demo` account, through the same `logInAction` as the form above.
 *
 * Rendered only by `next dev` against a Supabase on this machine. `developmentSupabaseTarget` is a
 * constant null in a production build, so this returns before anything is drawn there; against
 * a hosted project it also returns, because demo accounts only exist locally.
 */
function DemoSignIn() {
  if (developmentSupabaseTarget() !== 'local') return null;

  const personas = [
    { label: 'Platform admin', email: 'staff@gold.test' },
    ...BUSINESSES.flatMap((business) => [
      { label: `Owner · ${business.name}`, email: business.owner.email },
      { label: `Staff · ${business.name}`, email: business.member.email },
    ]),
  ];
  return <DemoAccountButtons action={logInAction} accounts={personas} password={DEMO_PASSWORD} />;
}
