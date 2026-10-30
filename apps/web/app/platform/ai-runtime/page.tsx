import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry } from '@/lib/platform-navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderServices } from '@/lib/domain/providers/services';
import { listProviderAccounts } from '@/lib/domain/providers/accounts';
import { listAiRuntimeAssignments, voiceSessionOperations } from '@/lib/domain/ai/runtime';
import { AiRuntimeWorkspace } from '@/features/platform/ai-runtime/ai-runtime-workspace';
import type { RuntimeAccount, RuntimeService } from '@/features/platform/ai-runtime/runtime-assignment-form';

export const dynamic = 'force-dynamic';

const AI_PROVIDER_KEYS = ['anthropic', 'openai', 'google', 'voice_agent'] as const;

export default async function AiRuntimePage({ params }: PageProps<'/platform/ai-runtime'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.providers');

  const db = await getDb();
  const [providers, allServices, assignments, accountLists, voiceSessions] = await Promise.all([
    listProviders(db),
    listProviderServices(db),
    listAiRuntimeAssignments(db),
    Promise.all(AI_PROVIDER_KEYS.map((providerKey) => listProviderAccounts(db, { providerKey }))),
    voiceSessionOperations(db),
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
        An unassigned capability keeps this deployment&rsquo;s existing default; an assigned one never silently falls back to another vendor. Assignments select a service, account and model; they do not verify a provider run.
      </Hint>
      <AiRuntimeWorkspace assignments={assignments} services={services} accounts={accounts} />
      <Section className="mt-6"><SectionHeading>Recent voice sessions</SectionHeading><Hint>The latest 25 admitted sessions. Unknown usage retains the maximum reservation; an uncertain transfer or connection needs provider/carrier reconciliation.</Hint>
        {voiceSessions.length?<ul className="mt-3 divide-y divide-border">{voiceSessions.map(session=><li key={session.id} className="space-y-1 py-3 text-sm"><p>{session.provider_account_label} ? {session.state}</p><p className="break-all text-muted">Business {session.organization_id} ? Call {session.call_id}</p><p>{session.reported_seconds===null?`Usage unknown; ${session.max_seconds} seconds reserved`:`${session.reported_seconds} reported seconds`}</p></li>)}</ul>:<p className="mt-3 text-sm text-muted">No admitted voice sessions.</p>}
      </Section>
    </AppPage>
  );
}
