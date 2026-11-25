import { Badge } from '@/components/display/data';
import { InfoPopover } from '@/components/controls/info-popover';
import { CardSection, Disclosure } from '@/components/surfaces/card';
import {
  SENDING_DOMAIN_BADGE,
  sendingDomainPresentation,
  sendingDomainSentence,
  type SendingDomain,
} from '@/lib/domain/email/sending-domains';
import { AddSendingDomainForm } from './add-sending-domain-form';
import { RequiredRecordsTable } from './required-records-table';
import { SendingDomainActions } from './sending-domain-actions';

/** A moment as a sentence ends it: some locales already end the time with a full stop (p.m.). */
function when(value: string): string {
  const text = new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * A business's sending domains, where each stands and what to do next, read from the rows — so the
 * provider's last answer is still here after the page is closed and reopened.
 *
 * One card: each domain with its status, the time the provider last answered and its one next
 * action, and — only while it still needs them — its DNS records beneath it, because those are what
 * a person came back for. Whether GildOps can publish them is a separate fact from whether they are
 * required: `automated` comes from this business's own connected DNS zones. Adding another domain
 * stays available beneath the list.
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
  const standing = withStanding(domains, automatedZone);

  return (
    <CardSection
      title="Sending domains"
      action={
        <InfoPopover label="What verifying a domain does">
          It lets this business send from addresses at the domain. It does not create a mailbox: replies and other mail to those
          addresses still go wherever the domain&rsquo;s mail records point today.
        </InfoPopover>
      }
    >
      {standing.length === 0 ? (
        <AddSendingDomainForm organizationId={organizationId} />
      ) : (
        <>
          <ul aria-label="Sending domains" className="mt-2 flex flex-col divide-y divide-border">
            {standing.map((domain) => {
              const badge = SENDING_DOMAIN_BADGE[domain.presentation];
              const ready = domain.presentation === 'ready';
              const needsRecords = !ready && domain.records.length > 0 && domain.outstandingRecords > 0;
              const recordsHeading = `dns-records-${domain.resourceId}`;
              return (
                <li key={domain.resourceId} className="flex min-w-0 flex-col gap-3 py-4 first:pt-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-medium">{domain.domain}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <p className="text-sm">
                      {sendingDomainSentence(domain.presentation, domain)}
                      {ready && domain.lastVerifiedAt ? <span className="text-xs text-muted"> Verified {when(domain.lastVerifiedAt)}</span> : null}
                      {!ready && domain.checkedAt ? <span className="text-xs text-muted"> Last checked {when(domain.checkedAt)}</span> : null}
                    </p>
                  </div>
                  <SendingDomainActions
                    organizationId={organizationId}
                    resourceId={domain.resourceId}
                    domain={domain.domain}
                    canStart={domain.presentation === 'not_created'}
                    canCheck={!ready}
                    canApply={domain.presentation === 'automatic_dns'}
                  />
                  {needsRecords ? (
                    <section aria-labelledby={recordsHeading} className="flex min-w-0 flex-col gap-2">
                      <h3 id={recordsHeading} className="text-sm font-semibold">DNS records</h3>
                      <p className="text-sm">
                        {domain.presentation === 'automatic_dns'
                          ? `Apply and verify publishes these in your connected ${domain.zoneName} zone.`
                          : 'Add these at your DNS host, then check verification.'}
                      </p>
                      <RequiredRecordsTable records={domain.records} />
                    </section>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Disclosure summary="Add another domain" className="mt-2">
            <AddSendingDomainForm organizationId={organizationId} />
          </Disclosure>
        </>
      )}
    </CardSection>
  );
}

/** Each domain with what its row reads as: zone, record counts and presentation. */
function withStanding(domains: SendingDomain[], automatedZone: (domain: string) => string | null) {
  return domains.map((domain) => {
    const zoneName = automatedZone(domain.domain);
    return {
      ...domain,
      zoneName,
      totalRecords: domain.records.length,
      missingRecords: domain.records.filter((record) => record.status === 'failed').length,
      presentation: sendingDomainPresentation({ ...domain, automated: zoneName !== null }),
    };
  });
}
