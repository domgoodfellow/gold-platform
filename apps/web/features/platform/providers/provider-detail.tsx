import type { ReactNode } from 'react';
import { Section, SectionHeading } from '@/components/surfaces/section';
import type { ProviderService } from '@/lib/domain/providers/services';
import { ImplementationStateBadge } from '@/features/catalogue/implementation-state';

const VENDOR_STATUS_LABEL: Record<string, string> = {
  generally_available: 'Generally available',
  preview: 'Preview',
  restricted: 'Restricted',
  legacy: 'Legacy',
};

/**
 * A Provider that has no account model of its own — Google, OpenAI, Anthropic today. Its
 * Provider Services, grouped by family, each carrying two independent facts (section 42):
 * `implementationState` is what GOLD runs; `vendorStatus` is the upstream service's own
 * maturity. The route keeps `PageHeader` itself (`workspace-shell.test.ts`'s one-page-identity
 * rule); this owns only the body below it. Twilio keeps its own telephony-specific operational
 * page rather than being forced through this shape — an account model this generic composition
 * does not assume.
 */
export function ProviderDetail({
  services,
  accountSection,
}: {
  services: ProviderService[];
  /** Operational account detail — only for a Provider that actually has that model. */
  accountSection?: ReactNode;
}) {
  const families = [...new Set(services.map((service) => service.family))];

  return (
    <>
      {accountSection}

      <Section className="mt-6">
        <SectionHeading>Services</SectionHeading>
        {services.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No services catalogued yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-6">
            {families.map((family) => (
              <div key={family}>
                <h3 className="mb-2 text-sm font-medium text-subtle">{family}</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {services
                    .filter((service) => service.family === family)
                    .map((service) => (
                      <li key={service.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{service.label}</p>
                          {service.description ? <p className="text-sm text-muted">{service.description}</p> : null}
                          {service.features.length > 0 ? (
                            <p className="mt-1 text-xs text-subtle">
                              Used by GildOps for: {service.features.map((feature) => feature.featureLabel).join(', ')}
                            </p>
                          ) : null}
                          {typeof service.metadata.note === 'string' ? (
                            <p className="mt-1 text-xs text-subtle">{service.metadata.note}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <ImplementationStateBadge state={service.implementationState} />
                          <span className="text-xs text-subtle">Vendor: {VENDOR_STATUS_LABEL[service.vendorStatus]}</span>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
