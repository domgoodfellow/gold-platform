import { Hint } from '@/components/controls/inputs';
import { PageHeading } from '@/components/containers/section';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';

/**
 * A business, in its own words, at the top of a page strangers can see.
 *
 * **Every string rendered here is a row that business wrote.** There is no heading of the
 * platform's, no strapline, no "Book with us" — `constraints.md` forbids hardcoding a claim a
 * business makes about itself, and a public page is where that rule was always pointing.
 *
 * A business that has configured nothing renders its name and stops. That is deliberate and it
 * is the whole reason `displayName` falls back rather than being nullable: "it has said
 * nothing" must not become the platform saying something on its behalf.
 *
 * Lives in `features/` rather than beside a route because two surfaces need it — booking
 * renders it, admin previews what it will look like — and D23 says one component file
 * extended, never a parallel set per surface.
 *
 * **The logo is the one thing here the business did not write in words**, and it is the same
 * kind of claim: a mark a business puts on its own page. It is optional exactly as every line
 * below it is, so a business that has uploaded nothing renders its name and stops, unchanged.
 */
export function PublicHeader({
  profile,
  logoUrl = null,
}: {
  profile: PublicProfile;
  logoUrl?: string | null;
}) {
  const contacts = [profile.contactPhone, profile.contactEmail, profile.address].filter(Boolean);

  return (
    <header>
      {logoUrl ? (
        // A tenant's own upload in a public bucket, not a build-time asset, and `next/image`
        // would need every deployment's storage host named in its config.
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
        // `whitespace-pre-line` so a business's own paragraph breaks survive. It typed them.
        <p className="mt-4 text-sm whitespace-pre-line opacity-80">{profile.intro}</p>
      ) : null}

      {contacts.length > 0 ? (
        <Hint className="mt-4">{contacts.join(' · ')}</Hint>
      ) : null}
    </header>
  );
}
