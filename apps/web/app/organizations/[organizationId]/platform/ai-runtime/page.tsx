import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry } from '@/lib/platform-navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderServices } from '@/lib/domain/providers/services';
import { listProviderAccounts } from '@/lib/domain/providers/accounts';
import { listAiRuntimeAssignments } from '@/lib/domain/ai/runtime';
import { AiRuntimeWorkspace } from '@/features/platform/ai-runtime/ai-runtime-workspace';
import type { RuntimeAccount, RuntimeService } from '@/features/platform/ai-runtime/runtime-assignment-form';

export const dynamic = 'force-dynamic';

const AI_PROVIDER_KEYS = ['anthropic', 'openai', 'google'] as const;

export default async function AiRuntimePage({ params }: PageProps<'/organizations/[organizationId]/platform/ai-runtime'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.providers');

  const db = await getDb();
  const [providers, allServices, assignments, accountLists] = await Promise.all([
    listProviders(db),
    listProviderServices(db),
    listAiRuntimeAssignments(db),
    Promise.all(AI_PROVIDER_KEYS.map((providerKey) => listProviderAccounts(db, { providerKey }))),
  ]);

  const providerLabel = new Map(providers.map((provider) => [provider.key, provider.label]));

  // Only what this runtime can actually answer through — the same rule
  // `record_ai_runtime_assignment` enforces, checked again here so the form never offers what the
  // database would refuse.
  const services: RuntimeService[] = allServices
    .filter((service) => service.kind === 'runtime' && service.implementationState === 'available')
    .map((service) => ({
      id: service.id,
      providerKey: service.providerKey,
      providerLabel: providerLabel.get(service.providerKey) ?? service.providerKey,
      label: service.label,
    }));

  const accounts: RuntimeAccount[] = accountLists.flat().map((account) => ({
    id: account.id,
    providerKey: account.providerKey,
    label: account.label,
    isUsable: account.status === 'active' && Boolean(account.credentialSetAt),
  }));

  return (
    <AppPage>
      <PageHeader title="AI Runtime" crumbs={platformAncestry(goldId, 'ai-runtime')} />
      <Hint className="mb-4 block">
        An unassigned capability keeps this deployment&rsquo;s existing default; an assigned one never silently falls back to another vendor.
      </Hint>
      <AiRuntimeWorkspace assignments={assignments} services={services} accounts={accounts} />
    </AppPage>
  );
}
