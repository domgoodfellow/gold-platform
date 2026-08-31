import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { isPlatformStaff, listTenants } from '@/lib/domain/platform/tenants';
import { ProvisionForm } from './provision-form';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  const db = await getDb();
  await signOut(db);
  redirect('/sign-in');
}

/**
 * The first screen in this application built for us rather than for a tenant.
 *
 * **`(platform)` is a route group and therefore a layout boundary, never a security one** —
 * the same thing `(auth)` and `(public)` are. What keeps a member out of this page is that
 * `platform_tenants` runs `security_invoker`, so a member selecting from it sees their own
 * organizations and a stranger sees nothing. The redirect below is courtesy, exactly as
 * `proxy.ts` is: delete it and this page shows a non-staff visitor an empty list, which is
 * ugly and still correct.
 *
 * **It names no area and has no sidebar**, because `lib/navigation.ts` holds the nouns of *a
 * business* and this is not one. A platform noun list would be a second navigation with one
 * entry; when this console has three screens it can have a shell, and not before.
 */
export default async function PlatformPage() {
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  if (!(await isPlatformStaff(db))) {
    redirect('/organizations');
  }

  const tenants = await listTenants(db);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Platform</h1>
        <form action={signOutAction}>
          <button type="submit" className="text-sm underline underline-offset-4 opacity-70">
            Sign out
          </button>
        </form>
      </div>

      <p className="mt-2 text-sm opacity-70">
        {tenants.length === 1 ? '1 business' : `${tenants.length} businesses`} on GOLD.
      </p>

      {/*
        The operator door (D29). It sits above the list because provisioning is the thing this
        console *does* — the list is what it shows. A business arrives here and appears in the
        table below on the next render, which is `newest first` earning its ordering.
      */}
      <ProvisionForm />

      {tenants.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No business has been provisioned yet.</p>
      ) : (
        // Scrolls inside itself rather than pushing the page sideways.
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-black/10 text-xs uppercase tracking-wide opacity-60 dark:border-white/15">
              <tr>
                <th className="py-2 pr-4 font-medium">Business</th>
                <th className="py-2 pr-4 font-medium">Arrived</th>
                <th className="py-2 pr-4 font-medium">Trades in</th>
                <th className="py-2 pr-4 font-medium">Switched on</th>
                <th className="py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 dark:divide-white/15">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="align-top">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{tenant.name}</span>
                    {tenant.slug ? (
                      <span className="block text-xs opacity-60">/book/{tenant.slug}</span>
                    ) : null}
                  </td>
                  {/*
                    Rendered in the tenant's own zone, not ours. A console that showed every
                    business in one timezone would be the platform deciding what "Tuesday"
                    means for somebody in Tokyo (I9).
                  */}
                  <td className="py-3 pr-4 tabular-nums">
                    {new Date(tenant.createdAt).toLocaleDateString('en-CA', {
                      timeZone: tenant.timezone,
                    })}
                  </td>
                  <td className="py-3 pr-4">
                    {tenant.currency}
                    <span className="block text-xs opacity-60">{tenant.timezone}</span>
                  </td>
                  <td className="py-3 pr-4">
                    {tenant.moduleKeys.length === 0 ? (
                      <span className="opacity-60">Kernel only</span>
                    ) : (
                      tenant.moduleKeys.join(', ')
                    )}
                  </td>
                  <td className="py-3 tabular-nums">
                    {tenant.lastActivityAt ? (
                      new Date(tenant.lastActivityAt).toLocaleString('en-CA', {
                        timeZone: tenant.timezone,
                      })
                    ) : (
                      <span className="opacity-60">Nothing yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
