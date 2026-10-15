import type { ApprovedService } from '@/lib/domain/customers/service-disclosures';
import { ARTIFACT_KINDS, SERVICE_KINDS } from '@/lib/domain/customers/service-engagements';

export function ServicePresentation({ service, summary = false, timezone = 'UTC' }: { service: ApprovedService; summary?: boolean; timezone?: string }) {
  return <article className="min-w-0 space-y-2 break-words [overflow-wrap:anywhere]">
    <h3 className="font-medium">{service.title}</h3>
    <p>{service.status}</p>
    <p className="text-xs text-muted">{SERVICE_KINDS[service.serviceKind]} · Updated <time dateTime={service.publishedAt}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone }).format(new Date(service.publishedAt))}</time></p>
    {summary ? <details><summary className="cursor-pointer py-2">View service update</summary><ServiceContent service={service}/></details> : <ServiceContent service={service}/>}
  </article>;
}
function ServiceContent({ service }: { service: ApprovedService }) {
  return <div className="space-y-3"><p className="whitespace-pre-wrap">{service.summary}</p>
    {service.deliverables.length ? <details><summary className="cursor-pointer py-2">Deliverables ({service.deliverables.length})</summary><ul className="space-y-3">{service.deliverables.map((item, index) => <li key={index} className="space-y-1">
      <p className="font-medium">{item.title}</p><p className="text-xs text-muted">{ARTIFACT_KINDS[item.kind as keyof typeof ARTIFACT_KINDS]}</p><p>{item.status}</p>{item.summary ? <p className="whitespace-pre-wrap">{item.summary}</p> : null}
      {item.url ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={item.url} target="_blank" rel="noopener noreferrer">Open {item.title}</a> : null}
    </li>)}</ul></details> : null}
  </div>;
}
