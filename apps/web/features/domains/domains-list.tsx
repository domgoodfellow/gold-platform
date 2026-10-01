import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { CustomDomain } from '@/lib/domain/domains/domains';
import { isDnsAutomated } from '@/lib/domain/domains/dns-zones';
import { DOMAIN_SURFACES, domainPresentation } from '@/lib/domain/domains/presentation';
import { DnsRecordTable } from './dns-record-table';
import { DomainRowActions } from './domain-row-actions';
import { DomainStateBadge, domainStateSentence } from './domain-status';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

/**
 * A business's custom domains and where each stands. Read from the rows, so an answer the dialog
 * received is here after it closes; a domain still waiting on DNS shows its records beneath the
 * table, because those are what a person came back for.
 */
export function DomainsList({
  organizationId,
  domains,
  mayManage,
  cloudflareZones,
}: {
  organizationId: string;
  domains: CustomDomain[];
  mayManage: boolean;
  cloudflareZones: string[];
}) {
  const waiting = domains.filter((domain) => domainPresentation(domain) === 'pending_dns' && domain.dnsRecords.length > 0);

  return (
    <Section>
      <SectionHeading>Your domains</SectionHeading>
      <div className="mt-2">
        <DataTable
          rows={domains}
          rowKey={(domain) => domain.id}
          empty="No custom domains connected."
          columns={[
            {
              key: 'hostname',
              header: 'Domain',
              emphasis: 'primary',
              cell: (domain) => (
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {domain.hostname}
                  {domain.isPrimary ? <Badge>Primary</Badge> : null}
                </span>
              ),
            },
            {
              key: 'surface',
              header: 'Opens',
              cell: (domain) => DOMAIN_SURFACES.find((surface) => surface.key === domain.surface)?.label ?? domain.surface,
            },
            {
              key: 'state',
              header: 'Status',
              cell: (domain) => {
                const presentation = domainPresentation(domain);
                return (
                  <div className="flex flex-col gap-1">
                    <DomainStateBadge presentation={presentation} />
                    <span className="text-xs text-muted">{domainStateSentence(presentation, domain)}</span>
                  </div>
                );
              },
            },
            { key: 'checked', header: 'Last checked', emphasis: 'secondary', cell: (domain) => when(domain.lastCheckedAt) },
          ]}
          actions={
            mayManage
              ? (domain) => {
                  const presentation = domainPresentation(domain);
                  return (
                    <DomainRowActions
                      organizationId={organizationId}
                      domainId={domain.id}
                      hostname={domain.hostname}
                      canRecheck={presentation !== 'conflict'}
                      canMakePrimary={presentation === 'active' && !domain.isPrimary}
                    />
                  );
                }
              : undefined
          }
        />
      </div>

      {waiting.map((domain) => {
        const automated = isDnsAutomated(domain.hostname, cloudflareZones);
        return (
          <div key={domain.id} className="mt-6 flex flex-col gap-2">
            <h3 className="text-sm font-medium">Records for {domain.hostname}</h3>
            <Hint>
              {automated
                ? 'DNS is managed through your connected Cloudflare account. GildOps is publishing these records automatically — this can take a few minutes. Press Check again to confirm.'
                : 'Add these at the company that manages DNS for this domain, then press Check again.'}
            </Hint>
            <DnsRecordTable records={domain.dnsRecords} />
          </div>
        );
      })}
    </Section>
  );
}
