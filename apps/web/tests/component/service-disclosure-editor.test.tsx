// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceDisclosureEditor } from '@/features/crm/customers/service-disclosure-editor';
import { disclosureAction } from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/service-actions';
import { PortalModulePresenter } from '@/features/studio/portal/portal-renderer';
import { newPortalModule } from '@/lib/domain/portal/composition';
import type { Engagement } from '@/lib/domain/customers/service-engagements';
import type { DisclosureContent, ServiceDisclosure, DisclosureRevision } from '@/lib/domain/customers/service-disclosures';
vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/service-actions', () => ({ disclosureAction: vi.fn(async () => ({error:null,saved:true})) }));
afterEach(() => { cleanup(); vi.mocked(disclosureAction).mockClear(); });
const engagement: Engagement = {organization_id:'org',id:'eng',customer_id:'customer',name:'PRIVATE name',service_kind:'website',status:'active',relationship_id:null,tenant_organization_id:null,opportunity_id:null,proposal_id:null,accepted_terms:null,created_at:'2026-10-14T12:00:00Z',created_by:'actor',updated_at:'2026-10-14T12:00:00Z',updated_by:'actor',started_at:null,completed_at:null,ended_at:null};
const content: DisclosureContent = {title:'Approved website',serviceKind:'website',summary:'Ready for review.',status:'In review',deliverables:[]};
const disclosure: ServiceDisclosure = {organization_id:'org',id:'disclosure',customer_id:'customer',engagement_id:'eng',draft_content:content,version:2,published_revision_id:'release',revision_number:1,created_at:'2026-10-14T12:00:00Z',created_by:'actor',updated_at:'2026-10-14T12:00:00Z',updated_by:'actor'};
const revision: DisclosureRevision = {organization_id:'org',id:'release',customer_id:'customer',engagement_id:'eng',disclosure_id:'disclosure',number:1,content,engagement_status:'active',published_at:'2026-10-14T12:00:00Z',published_by:'actor'};
const props = {organizationId:'org',customerId:'customer',customerName:'Acme Plumbing',organizationName:'GildOps Internal',engagement,mayManage:true,relationshipEnded:false,disclosure:null,history:[],deliverables:[],approvedDeliverables:[],onSaved:vi.fn()};
describe('service disclosure approval and customer presentation', () => {
  it('starts private, requires deliberate customer copy and previews without a session', async () => {
    const user=userEvent.setup(); render(<ServiceDisclosureEditor {...props}/>);
    expect(screen.getByText('Not shared')).toBeVisible(); expect(screen.queryByText('PRIVATE name')).toBeNull();
    await user.click(screen.getByRole('button',{name:'Prepare customer update'}));
    expect(screen.getByRole('button',{name:'Save customer draft'})).toBeDisabled();
    await user.type(screen.getByLabelText('Customer-facing title'),'Website');
    await user.type(screen.getByLabelText('Customer-facing description'),'<script>literal</script>');
    await user.type(screen.getByLabelText('Approved progress'),'In review');
    await user.click(screen.getByRole('button',{name:'Preview draft'}));
    const preview=screen.getByRole('region',{name:'Customer update preview'});
    expect(within(preview).getByText(/Customer: Acme Plumbing.*Portal: GildOps Internal.*Mode: Preview/)).toBeVisible();
    expect(within(preview).getByText('<script>literal</script>')).toBeVisible(); expect(preview.querySelector('script')).toBeNull();
    await user.click(screen.getByRole('button',{name:'Save customer draft'}));
    expect(await screen.findByText('Customer update saved.')).toBeVisible();
  });
  it('distinguishes draft from published and confirms explicit release and withdrawal', async () => {
    const user=userEvent.setup(); render(<ServiceDisclosureEditor {...props} disclosure={{...disclosure,draft_content:{...content,summary:'PRIVATE draft'}}} history={[revision]}/>);
    expect(screen.getByText('Visible to customer')).toBeVisible();expect(screen.getByText(/Saved draft changes/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Preview published update'}));expect(screen.getByText('Ready for review.')).toBeVisible();
    expect(screen.queryByText('PRIVATE draft')).toBeNull();
    await user.click(screen.getByRole('button',{name:'Close preview'}));expect(screen.getByRole('button',{name:'Preview published update'})).toHaveFocus();
    await user.click(screen.getByRole('button',{name:'Withdraw update'})); expect(screen.getByRole('button',{name:'Confirm withdrawal'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.getByRole('button',{name:'Withdraw update'})).toHaveFocus();await user.click(screen.getByRole('button',{name:'Publish update'}));
    expect(screen.getByRole('button',{name:'Confirm publication'})).toBeVisible();
  });
  it('shows lifecycle review and relationship suspension without offering management to read-only staff', () => {
    render(<ServiceDisclosureEditor {...props} mayManage={false} relationshipEnded disclosure={disclosure} history={[{...revision,engagement_status:'planned'}]}/>);
    expect(screen.getByText(/Engagement status changed/)).toBeVisible();expect(screen.getByText(/Relationship ended/)).toBeVisible();
    expect(screen.queryByRole('button',{name:'Publish update'})).toBeNull();
  });
  it('keeps publication failures visible for correction', async () => {
    vi.mocked(disclosureAction).mockResolvedValueOnce({error:'Customer update changed. Reload before publishing.',saved:false});
    const user=userEvent.setup();render(<ServiceDisclosureEditor {...props} disclosure={disclosure} history={[revision]}/>);
    await user.click(screen.getByRole('button',{name:'Publish update'}));await user.click(screen.getByRole('button',{name:'Confirm publication'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload before publishing');
    expect(screen.getByRole('button',{name:'Confirm publication'})).toBeEnabled();
  });
  it('renders list, cards and summary, long approved text, safe links and a truthful empty state', async () => {
    const service={id:'public',...content,publishedAt:'2026-10-14T12:00:00Z',summary:'x'.repeat(1500),deliverables:[{kind:'website',title:'Public website',summary:'Approved summary',status:'Review ready',url:'https://public.example.test/'}]};
    const {rerender}=render(<PortalModulePresenter module={newPortalModule('services')} records={[]}/>);
    expect(screen.getByText('No approved service updates are currently shared.')).toBeVisible();
    for(const variant of ['list','cards','summary']) {
      rerender(<PortalModulePresenter module={{...newPortalModule('services'),config:{heading:'Services',limit:20,variant}}} records={[{id:'public',title:service.title,detail:'',service}]}/>);
      expect(screen.getByRole('heading',{name:'Approved website'})).toBeVisible();
      if(variant==='summary') await userEvent.setup().click(screen.getByText('View service update'));
      await userEvent.setup().click(screen.getByText('Deliverables (1)'));
      expect(screen.getByRole('link',{name:'Open Public website'})).toHaveAttribute('rel','noopener noreferrer');
    }
  });
});
