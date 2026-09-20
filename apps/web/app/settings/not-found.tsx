import { FallbackPage } from '@/components/containers/fallback-page';
import { ButtonLink } from '@/components/controls/button';
import { PersonalSettingsShell } from '@/features/account/personal-settings-shell';
import { personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * There is no layout above Personal settings to draw a frame (each page calls
 * `PersonalSettingsShell` itself), so this boundary renders the same shell — the frame the rest of
 * `/settings` already lives in — rather than a second one.
 */
export default function SettingsNotFound() {
  return (
    <PersonalSettingsShell>
      {() => (
        <FallbackPage
          title="This page does not exist"
          description="The address may have changed, or the page may no longer be available."
          action={<ButtonLink href={personalSettingsHref('profile')}>Back to Personal settings</ButtonLink>}
        />
      )}
    </PersonalSettingsShell>
  );
}
