import Link from 'next/link';
import { configTarget, configTargetOffered, type ConfigGate } from '@/lib/navigation';
import type { ChannelDiagnostics } from '@/lib/domain/reception/channel-diagnostics';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
export function ChannelReadiness({ organizationId, diagnostics, maySend, channel, gate }: { organizationId: string; diagnostics: ChannelDiagnostics; maySend: boolean; channel?: 'sms' | 'email'; gate: ConfigGate }) {
 return <div className="space-y-4">{(['sms', 'email'] as const).filter(key => !channel || key === channel).map(key => <Section key={key}><SectionHeading>{key === 'sms' ? 'SMS sending checks' : 'Email sending checks'}</SectionHeading>
 {!maySend ? <Hint className="mt-2">Your role cannot send messages.</Hint> : null}
 {diagnostics[key].length ? <ul className="mt-3 space-y-2 text-sm">{diagnostics[key].map((blocker, index) => <li key={`${blocker.code}-${index}`} className="rounded border border-border p-3"><p>{blocker.message}</p>{blocker.target && configTargetOffered(configTarget(blocker.target), gate) ? <Link className="mt-1 inline-block text-accent-text underline" href={`/organizations/${organizationId}/${configTarget(blocker.target).path}`}>{blocker.target === 'features' ? 'Feature availability' : blocker.target === 'email' ? 'Email sending settings' : 'Numbers & assignments'}</Link> : null}</li>)}</ul> : <Hint className="mt-2">Ready to send.</Hint>}
 {key === 'sms' ? <Hint className="mt-3">People who opted out cannot be texted.</Hint> : null}
 </Section>)}</div>;
}
