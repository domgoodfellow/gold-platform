// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { CrmHome,type CrmHomeProps } from '@/features/crm/home/crm-home';
vi.mock('@/features/crm/customers/create-customer-sheet',()=>({CreateCustomerTrigger:()=> <button>New customer</button>}));
vi.mock('@/features/crm/opportunities/opportunity-sheet',()=>({OpportunitySheet:()=> <button>New opportunity</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-sheet',()=>({FollowUpSheet:({children,item}:{children?:string;item?:unknown})=><button>{children??(item?'Edit follow-up':'New follow-up')}</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-list',()=>({FollowUpList:({items}:{items:{title:string}[]})=><ul>{items.map(item=><li key={item.title}>{item.title}</li>)}</ul>}));
vi.mock('@/components/panels/workspace-right-rail',()=>({SupportTrigger:()=> <button>Configure</button>}));
const defaults:CrmHomeProps={organizationId:'org',timezone:'America/Toronto',month:'2026-10-01',summary:{customers:120,open:8,today:3,overdue:1,noNext:5,unassigned:2,forecast:[{currency:'CAD',amount_minor:'125050'},{currency:'USD',amount_minor:'50000'}],pipeline:[],won:0,lost:0},customers:[],customerContext:{},opportunitySummary:[],opportunities:[],today:[{id:'today',title:'Call today'}] as CrmHomeProps['today'],overdue:[{id:'overdue',title:'Review overdue'}] as CrmHomeProps['overdue'],noNext:[],unassigned:[],followUpOptions:{organizationId:'org',timezone:'America/Toronto',members:[],mayManage:false},opportunityOptions:{organizationId:'org',stages:[],members:[],defaultCurrency:'CAD'},followUpsEnabled:true,conversionEnabled:true,mayCreate:false,mayCreateOpportunity:false,mayConfigure:false,activity:<p>No CRM activity yet.</p>};
afterEach(cleanup);
describe('operational CRM dashboard',()=>{
  it('renders exact summaries, separate currencies and intentional filtered KPI destinations',()=>{
    render(<CrmHome {...defaults}/>);
    expect(screen.getByRole('link',{name:/Customers 120/})).toHaveAttribute('href','/organizations/org/customers');
    expect(screen.getByRole('link',{name:/Open opportunities 8/})).toHaveAttribute('href','/organizations/org/opportunities?kind=open');
    expect(screen.getByRole('link',{name:/Follow-ups due today 3/})).toHaveAttribute('href','/organizations/org/follow-ups?status=open&due=today');
    expect(screen.getByRole('link',{name:/Forecast this month/})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&closeFrom=2026-10-01&closeBefore=2026-11-01');
    expect(screen.getByText('CA$1,250.50')).toBeInTheDocument();expect(screen.getByText('US$500.00')).toBeInTheDocument();
    expect(screen.getByText('No closed opportunities')).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.getByLabelText('Reporting month')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'View pipeline'})).toHaveAttribute('href','/organizations/org/opportunities/pipeline');
    expect(screen.getByRole('link',{name:'View calendar'})).toHaveAttribute('href','/organizations/org/follow-ups/calendar');
  });
  it('changes attention inline and sends View all to the selected full collection',async()=>{
    render(<CrmHome {...defaults}/>);const user=userEvent.setup();
    expect(screen.getByText('Review overdue')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:/No next follow-up 5/}));
    expect(screen.getByRole('link',{name:'View all'})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&next=none');
    await user.click(screen.getByRole('button',{name:/Unassigned opportunities 2/}));
    expect(screen.getByRole('link',{name:'View all'})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&owner=unassigned');
  });
  it('keeps reduced roles read-only and hides disabled feature destinations',()=>{
    render(<CrmHome {...defaults} followUpsEnabled={false} conversionEnabled={false}/>);
    expect(screen.queryByRole('button',{name:'New customer'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'New opportunity'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'New follow-up'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Configure'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'View calendar'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/No next follow-up/})).not.toBeInTheDocument();
  });
  it('offers canonical drawers only for authorized mutation and calculates real win rate',()=>{
    render(<CrmHome {...defaults} mayCreate mayCreateOpportunity mayConfigure followUpOptions={{...defaults.followUpOptions,mayManage:true}} summary={{...defaults.summary,won:3,lost:1}}/>);
    for(const name of ['New customer','New opportunity','New follow-up','Configure'])expect(screen.getByRole('button',{name})).toBeInTheDocument();expect(screen.getByText('75%')).toBeInTheDocument();
  });
});
