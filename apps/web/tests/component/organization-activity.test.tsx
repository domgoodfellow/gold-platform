// @vitest-environment jsdom
import {cleanup,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {TooltipProvider} from '@gold/ui/components/tooltip';
import {OrganizationActivity} from '@/features/timeline/organization-activity';
import {loadOrganizationActivityAction} from '@/features/timeline/organization-activity-actions';
import {WorkspaceRailProvider,PagePanel,OrganizationActivityTrigger,SupportTrigger} from '@/components/panels/workspace-right-rail';
import {SupportRegistrar} from '@/components/panels/support-registrar';
vi.mock('@/features/timeline/organization-activity-actions',()=>({loadOrganizationActivityAction:vi.fn()}));
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn().mockImplementation((query:string)=>({matches:query.includes('768')||query.includes('1280'),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()}))});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const ready={state:'ready' as const,data:{entries:[],more:false,limited:false}};
describe('organization Activity utility',()=>{
 it('is lazy and independent of a page Activity panel, preserving its draft and returning keyboard focus',async()=>{
  vi.mocked(loadOrganizationActivityAction).mockResolvedValue(ready);
  render(<TooltipProvider><WorkspaceRailProvider organizationActivity={<OrganizationActivity organizationId="org" timezone="UTC"/>}><OrganizationActivityTrigger/><SupportTrigger mode="activity"/><SupportRegistrar mode="activity" title="CRM activity"><label>Draft<input aria-label="Draft" defaultValue="Keep this"/></label></SupportRegistrar><PagePanel/></WorkspaceRailProvider></TooltipProvider>);
  expect(loadOrganizationActivityAction).not.toHaveBeenCalled();const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Activity'}));await expect(screen.findByRole('dialog',{name:'CRM activity'})).resolves.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Organization activity'}));const panel=await screen.findByRole('dialog',{name:'Organization activity'});
  expect(panel).toHaveAttribute('aria-modal','false');await within(panel).findByText('Nothing recorded yet.');expect(loadOrganizationActivityAction).toHaveBeenCalledWith('org',20);
  await user.keyboard('{Escape}');expect(screen.queryByRole('dialog',{name:'Organization activity'})).toBeNull();expect(screen.getByRole('button',{name:'Organization activity'})).toHaveFocus();
  expect(screen.getByRole('textbox',{name:'Draft'})).toHaveValue('Keep this');
 });
 it('shows unavailable distinctly from empty, retries, and follows bounded load-more requests',async()=>{
  vi.mocked(loadOrganizationActivityAction).mockResolvedValueOnce({state:'unavailable'}).mockResolvedValueOnce({state:'ready',data:{entries:[{id:'1',occurredAt:'2026-11-16T12:00:00Z',action:'work_item.created',description:'Work created: Authorized',actorName:'Owner',context:'Work',href:'/organizations/org/work/w1'}],more:true,limited:false}}).mockResolvedValue(ready);
  render(<OrganizationActivity organizationId="org" timezone="UTC"/>);expect(screen.getByRole('status')).toHaveTextContent('Loading activity');
  await screen.findByText('Activity is unavailable.');expect(screen.queryByText('Nothing recorded yet.')).toBeNull();const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Try again'}));
  const link=await screen.findByRole('link',{name:'Work created: Authorized'});expect(link).toHaveAttribute('href','/organizations/org/work/w1');expect(screen.getByText('Owner')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Load more'}));await waitFor(()=>expect(loadOrganizationActivityAction).toHaveBeenLastCalledWith('org',40));
 });
});
