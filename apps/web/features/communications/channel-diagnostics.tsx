import Link from 'next/link';
import { configTarget, configTargetOffered, type ConfigGate } from '@/lib/navigation';
import type { ChannelDiagnostics } from '@/lib/domain/reception/channel-diagnostics';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
export function ChannelReadiness({ organizationId, diagnostics, maySend, channel, gate }: { organizationId: string; diagnostics: ChannelDiagnostics; maySend: boolean; channel?: 'sms' | 'email'; gate: ConfigGate }) {
 return <div className="space-y-4">{(['sms', 'email'] as const).filter(key => !channel || key === channel).map(key => <Section key={key}><SectionHeading>{key === 'sms' ? 'SMS sending checks' : 'Email sending checks'}</SectionHeading>
 {!maySend ? <Hint className="mt-2">Your role lacks message.send permission. Configuring this channel does not authorize sending.</Hint> : null}
 {diagnostics[key].length ? <ul className="mt-3 space-y-2 text-sm">{diagnostics[key].map((blocker, index) => <li key={`${blocker.code}-${index}`} className="rounded border border-border p-3"><p>{blocker.message}</p>{blocker.target && configTargetOffered(configTarget(blocker.target), gate) ? <Link className="mt-1 inline-block text-accent-text underline" href={`/organizations/${organizationId}/${configTarget(blocker.target).path}`}>{blocker.target === 'features' ? 'Feature availability' : blocker.target === 'email' ? 'Sending domains & identities' : 'Numbers & assignments'}</Link> : null}</li>)}</ul> : <Hint className="mt-2">Configuration checks passed. Provider acceptance and delivery must still be confirmed by actual message events.</Hint>}
 <Hint className="mt-3">{key === 'sms' ? 'The sender and recipient are validated again at send. Opted-out recipients cannot be contacted. Delivery-status callbacks record provider results.' : 'Outbound delivery does not imply mailbox synchronization. The existing Inbox retains message threads, attachment states, retries, and delivery events where supported.'}</Hint>
 </Section>)}</div>;
}
