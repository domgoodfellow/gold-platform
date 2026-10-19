import { formatPhoneForDisplay } from '@/lib/display/phone';
import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/surfaces/section';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';

/**
 * A business, in its own words, at the top of a page strangers can see — every string here is
 * one the business wrote, never a platform heading or strapline. Renders name-only when nothing
 * else is configured. Lives in `features/` because both booking and admin preview use it.
 */
export function PublicHeader({
  profile,
  logoUrl = null,
}: {
  profile: PublicProfile;
  logoUrl?: string | null;
}) {
  const contacts = [profile.contactPhone ? formatPhoneForDisplay(profile.contactPhone) : null, profile.contactEmail, profile.address].filter(Boolean);

  return (
    <header>
      {logoUrl ? (
        // A tenant's own upload in a public bucket, not a build-time asset — next/image would
        // need every deployment's storage host named in its config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="mb-4 max-h-16 w-auto max-w-64 object-contain"
        />
      ) : null}

      <PageHeading>{profile.displayName}</PageHeading>

      {profile.tagline ? <p className="mt-1 text-sm opacity-80">{profile.tagline}</p> : null}

      {profile.intro ? (
        <p className="mt-4 text-sm whitespace-pre-line opacity-80">{profile.intro}</p>
      ) : null}

      {contacts.length > 0 ? (
        <Hint className="mt-4">{contacts.join(' · ')}</Hint>
      ) : null}
    </header>
  );
}
