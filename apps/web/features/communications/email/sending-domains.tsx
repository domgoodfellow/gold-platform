import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { CardSection } from '@/components/surfaces/card';
import {
  SENDING_DOMAIN_BADGE,
  sendingDomainPresentation,
  sendingDomainSentence,
  type SendingDomain,
} from '@/lib/domain/email/sending-domains';
import { RequiredRecordsTable } from './required-records-table';
import { SendingDomainActions } from './sending-domain-actions';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

/**
 * A business's sending domains and where each stands, read from the rows — so an answer the
 * provider gave is still here after the page is closed and reopened.
 *
 * A domain still waiting on records shows them beneath the table, because those are what a person
 * came back for. Whether GildOps can publish them is a separate fact from whether they are
 * required: `automated` comes from this business's own connected DNS zones, and a domain outside
 * one gets the manual instruction it has always had rather than a button that would do nothing.
 */
export function SendingDomains({
  organizationId,
  domains,
  automatedZone,
}: {
  organizationId: string;
  domains: SendingDomain[];
  /** The connected zone that answers for a domain, or null when none does. */
  automatedZone: (domain: string) => string | null;
}) {
  const standing = domains.map((domain) => {
    const zoneName = automatedZone(domain.domain);
    return {
      ...domain,
      zoneName,
      presentation: sendingDomainPresentation({ ...domain, automated: zoneName !== null }),
    };
  });
  const waiting = standing.filter((domain) => domain.records.length > 0 && domain.presentation !== 'ready');

  return (
    <CardSection title="Your sending domains" className="mt-6">
      <div className="mt-3">
        <DataTable
          rows={standing}
          rowKey={(domain) => domain.resourceId}
          empty="No sending domain set up."
          columns={[
            { key: 'domain', header: 'Domain', emphasis: 'primary', cell: (domain) => <span className="font-medium">{domain.domain}</span> },
            {
              key: 'state',
              header: 'Status',
              cell: (domain) => (
                <div className="flex flex-col gap-1">
                  <span>
                    <Badge tone={SENDING_DOMAIN_BADGE[domain.presentation].tone}>
                      {SENDING_DOMAIN_BADGE[domain.presentation].label}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted">{sendingDomainSentence(domain.presentation, domain)}</span>
                </div>
              ),
            },
            {
              key: 'records',
              header: 'Records',
              visibility: 'card-only',
              cell: (domain) =>
                domain.records.length === 0 ? '—' : `${domain.records.length - domain.outstandingRecords} of ${domain.records.length} verified`,
            },
            { key: 'verified', header: 'Verified', visibility: 'card-only', cell: (domain) => when(domain.lastVerifiedAt) },
          ]}
          actions={(domain) => (
            <SendingDomainActions
              organizationId={organizationId}
              resourceId={domain.resourceId}
              domain={domain.domain}
              canStart={domain.presentation === 'not_created'}
              canApply={domain.presentation === 'automatic_dns'}
            />
          )}
        />
      </div>

      {waiting.map((domain) => (
        <div key={domain.resourceId} className="mt-6 flex flex-col gap-2">
          <h3 className="text-sm font-medium">Records for {domain.domain}</h3>
          <Hint>
            {domain.presentation === 'automatic_dns'
              ? `GildOps can publish these in your connected ${domain.zoneName} zone. Read them first — Apply and verify is what writes them, and anything it cannot safely change is reported back to you.`
              : 'Add these at the company that manages DNS for this domain, then press Check verification.'}
          </Hint>
          <RequiredRecordsTable records={domain.records} />
        </div>
      ))}
    </CardSection>
  );
}
