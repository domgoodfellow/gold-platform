import { ProfileForm } from '@/features/public-profile/profile-form';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listModuleSettings, outstandingModuleSetup } from '@/lib/domain/tenancy/modules';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { moduleConfiguration } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { updateProfileAction } from './actions';
import {
  AddOperatingHoursForm,
  OperatingHoursRow,
  OrganizationSettingsForm,
  ModuleSwitch,
  PaymentAccountRow,
} from './settings-forms';

export const dynamic = 'force-dynamic';

/**
 * What a business has told the platform about itself.
 *
 * Everything on this page is configuration a tenant owns, and none of it has a value the
 * platform chose. In particular the opening hours start **empty**: there is no seeded working
 * week, because a business that has said nothing about its hours has not said it is closed,
 * and inventing a nine-to-five would be the hardcoded business hours `constraints.md` forbids.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const provider = await paymentProvider();
  const [hours, profile, modules, paymentAccount] = await Promise.all([
    listOperatingHours(db, { organizationId }),
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    listModuleSettings(db, { organizationId }),
    provider ? getPaymentAccount(db, { organizationId, provider: provider.name }) : null,
  ]);

  // What is still missing for the modules this business has on (D31). Asked after the list,
  // because it is a question about the ones that are enabled and there is nothing to ask about
  // the rest.
  const enabled = new Set(
    modules.filter((entry) => entry.enabledAt !== null).map((entry) => entry.module.key),
  );
  const outstanding = await outstandingModuleSetup(db, { organizationId, enabled });

  const mayManage = organization.capabilities.includes('organization.manage');
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <>
      {/* The section ids here are anchors a module's switch links to (D31), so they are part
          of `navigation.ts`'s `configuredAt` contract rather than decoration.
          `navigation.test.ts` reads this file and fails on one that has been renamed away. */}
      <section
        id="public-page"
        className="mt-8 scroll-mt-6 border-t border-black/10 pt-6 dark:border-white/15"
      >
        <h2 className="text-sm font-medium">Public page</h2>
        <p className="mt-1 text-sm opacity-70">
          What customers see before they book. Everything here is this business&rsquo;s own
          words — the platform writes none of it, and a page left empty shows the business name
          and nothing else.
        </p>

        {mayManage ? (
          <ProfileForm
            organizationId={organizationId}
            profile={profile}
            slug={organization.slug}
            action={updateProfileAction}
          />
        ) : (
          <p className="mt-4 text-sm opacity-70">
            Your role, {organization.role}, cannot change what this business says about itself.
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">This business</h2>
        <p className="mt-1 text-sm opacity-70">
          Changing the currency does not reinterpret what past jobs cost, and changing the
          timezone does not move any booking — each amount carries the currency it was
          recorded in, and every scheduled window is an absolute instant.
        </p>

        {mayManage ? (
          <OrganizationSettingsForm
            organizationId={organizationId}
            name={organization.name}
            timezone={organization.timezone}
            bufferMinutes={organization.bufferMinutes}
            slug={organization.slug}
            currency={organization.currency}
          />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot change these.
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Opening hours</h2>
        <p className="mt-1 text-sm opacity-70">
          {hours.length === 0
            ? 'None set, so the schedule treats every hour as available. Nothing here is assumed — which days this business works, and when, are yours to say.'
            : `Used by the schedule to work out what is free. Times are read in ${organization.timezone}.`}
        </p>

        {hours.length > 0 ? (
          <div className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {hours.map((entry) =>
              mayConfigure ? (
                <OperatingHoursRow
                  key={entry.id}
                  organizationId={organizationId}
                  hours={entry}
                />
              ) : (
                <p key={entry.id} className="py-2 text-sm opacity-70">
                  {entry.opensAt.slice(0, 5)}–{entry.closesAt.slice(0, 5)}
                </p>
              ),
            )}
          </div>
        ) : null}

        {mayConfigure ? (
          <AddOperatingHoursForm organizationId={organizationId} />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot set opening hours.
          </p>
        )}
      </section>

      {/* **Shown whenever this business has card payments on — including when the deployment
          has no processor at all**, which is the change D31 exists for. This section used to be
          rendered behind `provider`, so a business could switch card payments on and find
          nothing here to fill in and no explanation. A switch that leads nowhere is worse than
          no switch: the operator believes they have finished. A business that has *not* switched
          card payments on still sees nothing, and that is the opposite case — the module is not
          part of that business, so there is nobody to explain anything to. */}
      {enabled.has('card_payments') ? (
        <section
          id="getting-paid"
          className="mt-8 scroll-mt-6 border-t border-black/10 pt-6 dark:border-white/15"
        >
          <h2 className="text-sm font-medium">Getting paid</h2>
          <p className="mt-1 text-sm opacity-70">
            Card payments go directly to this business. GOLD never holds the money, and this
            business keeps its own account with the payment provider.
          </p>
          {provider ? (
            <div className="mt-2 border-t border-black/10 dark:border-white/15">
              <PaymentAccountRow
                organizationId={organizationId}
                provider={provider.name}
                accountId={paymentAccount?.account.accountId ?? null}
                connectedAt={paymentAccount?.connectedAt ?? null}
                mayManage={mayManage}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm opacity-70">
              This deployment has no payment processor yet, so there is no account to connect.
              Nothing is wrong with this business&rsquo;s settings and there is nothing to do
              here until one is configured. Invoices still record cash and bank payments.
            </p>
          )}
        </section>
      ) : null}

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">What this business uses</h2>
        {/* Modules: what this business switched on and is billed for, not what a role may do
            (`constraints.md` D25). Switching one off removes its area from the navigation and
            removes nothing it produced — a business that stops offering public booking keeps
            every job somebody booked. */}
        <p className="mt-1 text-sm opacity-70">
          Turning something off hides it from this business. Nothing it has already recorded is
          removed. What every business gets — work, the schedule, customers, people and these
          settings — is not listed here, because it was never sold separately.
        </p>

        <div className="mt-2 divide-y divide-black/10 dark:divide-white/15">
          {modules.map(({ module, enabledAt }) => {
            // D31: a switch leads to its inputs. Resolved here rather than in the client
            // component because where a module is configured is `navigation.ts`'s answer, not a
            // control's.
            const where = moduleConfiguration(organizationId, module);

            return (
              <ModuleSwitch
                key={module.key}
                organizationId={organizationId}
                moduleKey={module.key}
                label={module.label}
                description={module.description}
                enabled={enabledAt !== null}
                mayConfigure={mayManage}
                configureHref={where.href}
                configureLabel={where.label}
                outstanding={outstanding.get(module.key) ?? null}
              />
            );
          })}
        </div>

        {mayManage ? null : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot change what this business uses.
          </p>
        )}
      </section>
    </>
  );
}
