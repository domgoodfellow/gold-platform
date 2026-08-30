import Link from 'next/link';

/**
 * GOLD's own front door.
 *
 * **This is not the marketing surface `constraints.md` D20 defers, and the two had been sharing
 * one word.** That record blocks marketing on the grounds that "every word on a public page a
 * business shows the world is a claim that business makes about itself" — which is true of a
 * *tenant's* site and is the reason a tenant's copy is a row in `organization_profiles`. It says
 * nothing about this page, where the business making the claim is GOLD. A per-tenant site with
 * pages and editable blocks stays deferred with its trigger unchanged; this speaks for the
 * platform, so `public-profile.test.ts` deliberately does not scan it.
 *
 * It has lived at `app/page.tsx` since M1 and nobody called it marketing. Naming the group is
 * what makes the distinction above findable instead of something the next contributor
 * rediscovers by reading D20 and concluding this page is forbidden.
 */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold">GOLD</h1>
      <p className="mt-2 text-sm opacity-70">
        One engine. Many businesses. Configuration, not forks.
      </p>
      <Link href="/organizations" className="mt-6 w-fit underline underline-offset-4">
        Organizations
      </Link>
    </main>
  );
}
