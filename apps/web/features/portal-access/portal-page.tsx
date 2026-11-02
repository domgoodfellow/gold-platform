import { notFound, redirect } from 'next/navigation';
import { getPortalDb } from '@/lib/db/portal-server';
import { requirePortalRequestContext } from '@/lib/domain/portal/request-context';
import { publishedPortalContent, portalModuleAvailability } from '@/lib/domain/portal/definitions';
import { portalPageForPath } from '@/lib/domain/portal/composition';
import { DomainError } from '@/lib/domain/errors';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { BrandStyle } from '@/features/branding/brand-style';
import { PublicHeader } from '@/features/public-profile/public-header';
import { PortalRenderer, type PortalPresentation } from '@/features/studio/portal/portal-renderer';
import { invoiceStanding, listInvoiceLines, listPayments } from '@/lib/domain/billing/invoices';
import { listInvoiceDocumentIds } from '@/lib/domain/billing/invoice-documents';
import { portalCardPaymentAvailable } from '@/lib/domain/billing/card-payments';
import { portalFormsAvailable } from '@/lib/domain/portal/portal-forms';
import { portalServiceDisclosures } from '@/lib/domain/customers/service-disclosures';
import { portalServiceReviews } from '@/lib/domain/customers/service-reviews';
import { CustomerNotificationPreferences } from './notification-preferences';
import { portalNotificationPreferences } from '@/lib/domain/customers/service-notifications';
import { ServiceReviewResponse } from './service-review-response';
import { PortalForms } from '@/features/portal-access/portal-forms';
import { formatWindow, parseWindow } from '@/lib/domain/scheduling/window';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { PayInvoiceForm } from './pay-invoice-form';
const requestTime = () => Date.now();

export async function CustomerPortalPage({ path }: { path?: string }) {
  const db = await getPortalDb();
  const now = requestTime();
  let context;
  try { context = await requirePortalRequestContext(db); }
  catch (error) { if (error instanceof DomainError) redirect('/portal/unavailable'); throw error; }
  const content = await publishedPortalContent(db);
  if (!content) redirect('/portal/unavailable');
  const page = portalPageForPath(content, path);
  if (!page || !content.navigation.some(entry => entry.pageId === page.id)) notFound();
  const organizationId = context.organizationId;
  const { data: organization } = await db.from('organizations').select('name,timezone').eq('id',organizationId).maybeSingle();
  if (!organization) notFound();
  const available = await portalModuleAvailability(db);
  const needs = new Set(page.modules.map(module => module.kind));
  const [profile, brand, items, invoices, forms, services] = await Promise.all([
    publicProfile(db,{organizationId,fallbackName:organization.name}), getBrand(db,{organizationId}),
    needs.has('work') && available.work ? db.from('work_items').select('id,title,scheduled_during,status:work_item_statuses!work_items_status_same_org_and_type(name)').order('created_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    needs.has('invoices') && available.invoices ? db.from('invoices').select('id,number,issued_at,currency').order('issued_at',{ascending:false}) : Promise.resolve({data:[],error:null}),
    needs.has('forms') && available.forms ? portalFormsAvailable(db) : Promise.resolve([]),
    needs.has('services') && available.services ? portalServiceDisclosures(db, undefined, Math.max(...page.modules.filter(module => module.kind === 'services').map(module => module.config.limit))) : Promise.resolve([]),
  ]);
  if (items.error || invoices.error) throw new Error('Customer records could not be loaded.');
  const documents = await listInvoiceDocumentIds(db, { organizationId, invoiceIds: (invoices.data ?? []).map(invoice => invoice.id) });
  const records: PortalPresentation = { work: (items.data ?? []).map(item => {
    const window = parseWindow(item.scheduled_during as string|null);
    const status = Array.isArray(item.status) ? item.status[0] : item.status;
    return { id:item.id,title:item.title,detail:[status?.name,window ? formatWindow(window,organization.timezone) : null].filter(Boolean).join(' · '),upcoming:!!window && new Date(window.startsAt).getTime() >= now };
  }), invoices: await Promise.all((invoices.data ?? []).map(async invoice => {
    const [lines,payments] = await Promise.all([listInvoiceLines(db,{organizationId,invoiceId:invoice.id}),listPayments(db,{organizationId,invoiceId:invoice.id})]);
    const standing = invoiceStanding({lines,payments});
    const payment = available.payments && page.modules.some(module => module.kind === 'invoices' && module.config.payments) && standing.outstandingMinor !== null && standing.outstandingMinor > 0 ? await portalCardPaymentAvailable(db,{invoiceId:invoice.id}) : null;
    const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:organization.timezone}).format(new Date(invoice.issued_at));
    const amount=standing.total ? formatMoney(standing.total.totalMinor,standing.total.currency) : 'Total unavailable';
    const balance=standing.settled ? 'paid' : standing.outstandingMinor !== null && standing.total ? `${formatMoney(standing.outstandingMinor,standing.total.currency)} due` : 'Balance unavailable';
    return { id:invoice.id,title:`#${invoice.number}`,detail:`${date} · ${amount} · ${balance}`,action:payment ? <PayInvoiceForm invoiceId={invoice.id} amountLabel={formatMoney(payment.outstandingMinor,payment.currency)}/> : null,
      document:documents.has(invoice.id) ? <p className="mt-2 text-sm"><a className="underline underline-offset-4" href={`/portal/invoices/${invoice.id}/document`} download>Download PDF<span className="sr-only"> of invoice #{invoice.number}</span></a></p> : null };
  })), forms: forms.map(form => ({id:form.formId,title:form.definition.title,detail:'',action:<PortalForms forms={[form]}/>})), services: await Promise.all(services.map(async service => {
    const reviews = await portalServiceReviews(db, service.id);
    return { id:service.id,title:service.title,detail:'',service,timezone:organization.timezone,action:reviews.length ? <div className="mt-4 space-y-4">{reviews.map(review => <ServiceReviewResponse key={review.id} review={review} timezone={organization.timezone}/>)}</div> : <p className="mt-3 text-xs text-muted">No review requested.</p> };
  })) };
  const notificationPreferences = await portalNotificationPreferences(db);
  return <main data-brand className="mx-auto w-full max-w-2xl p-3 sm:p-6"><BrandStyle brand={brand}/><PortalRenderer content={content} page={page} records={records} available={available} unbounded={available.defaultExperience} header={<PublicHeader profile={profile} logoUrl={brand.logoPath ? logoUrl(db,brand.logoPath) : null}/>}/><CustomerNotificationPreferences preferences={notificationPreferences}/></main>;
}
