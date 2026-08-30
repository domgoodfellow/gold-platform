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
 */
export function PublicHeader({ profile }: { profile: PublicProfile }) {
  const contacts = [profile.contactPhone, profile.contactEmail, profile.address].filter(Boolean);

  return (
    <header>
      <h1 className="text-2xl font-semibold">{profile.displayName}</h1>

      {profile.tagline ? <p className="mt-1 text-sm opacity-80">{profile.tagline}</p> : null}

      {profile.intro ? (
        // `whitespace-pre-line` so a business's own paragraph breaks survive. It typed them.
        <p className="mt-4 text-sm whitespace-pre-line opacity-80">{profile.intro}</p>
      ) : null}

      {contacts.length > 0 ? (
        <p className="mt-4 text-sm opacity-70">{contacts.join(' · ')}</p>
      ) : null}
    </header>
  );
}
