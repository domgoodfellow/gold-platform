// @vitest-environment jsdom
import { cleanup,render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { CrmHome,type CrmHomeProps } from '@/features/crm/home/crm-home';
vi.mock('@/features/crm/customers/create-customer-sheet',()=>({CreateCustomerTrigger:()=> <button>New customer</button>}));
vi.mock('@/features/crm/opportunities/opportunity-sheet',()=>({OpportunitySheet:()=> <button>New opportunity</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-sheet',()=>({FollowUpSheet:({children,item}:{children?:string;item?:unknown})=><button>{children??(item?'Edit follow-up':'New follow-up')}</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-list',()=>({FollowUpList:({items}:{items:{title:string}[]})=><ul>{items.map(item=><li key={item.title}>{item.title}</li>)}</ul>}));
vi.mock('@/components/panels/workspace-right-rail',()=>({SupportTrigger:({mode}:{mode:string})=> <button>{mode==='activity'?'Activity':mode==='insights'?'Insights':'Configure'}</button>}));
const stage={stageId:'s1',name:'Discovery',kind:'open',count:4,values:[]};
const defaults:CrmHomeProps={organizationId:'org',timezone:'America/Toronto',month:'2026-10-01',summary:{customers:120,open:8,today:3,overdue:1,noNext:5,unassigned:2,forecast:[{currency:'CAD',amount_minor:'125050'},{currency:'USD',amount_minor:'50000'}],pipeline:[],won:0,lost:0},customers:[],customerContext:{},opportunitySummary:[stage] as unknown as CrmHomeProps['opportunitySummary'],today:[{id:'today',title:'Call today'}] as CrmHomeProps['today'],overdue:[{id:'overdue',title:'Review overdue'}] as CrmHomeProps['overdue'],noNext:[],unassigned:[],followUpOptions:{organizationId:'org',timezone:'America/Toronto',members:[],mayManage:false},opportunityOptions:{organizationId:'org',stages:[],members:[],defaultCurrency:'CAD'},followUpsEnabled:true,conversionEnabled:true,mayCreate:false,mayCreateOpportunity:false,mayConfigure:false};
beforeEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }); });
afterEach(cleanup);
const panel=(name:string)=>screen.getByRole('heading',{name}).closest('section') as HTMLElement;
describe('operational CRM dashboard',()=>{
  it('renders exact summaries and intentional KPI destinations, with Today owning the agenda',()=>{
    render(<CrmHome {...defaults}/>);
    expect(screen.getByRole('link',{name:/Customers 120/})).toHaveAttribute('href','/organizations/org/customers');
    expect(screen.getByRole('link',{name:/Open opportunities 8/})).toHaveAttribute('href','/organizations/org/opportunities?kind=open');
    expect(screen.getByRole('link',{name:/Overdue follow-ups 1/})).toHaveAttribute('href','/organizations/org/follow-ups?status=open&due=overdue');
    expect(screen.queryByRole('link',{name:/Follow-ups due today/})).toBeNull();
    // Batch C: the day's agenda appears once, in Today, never again as a Needs attention category.
    expect(screen.getAllByText('Call today')).toHaveLength(1);
    expect(within(panel('Today')).getByText('Call today')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Due today/})).toBeNull();
    expect(screen.getByRole('link',{name:'View pipeline'})).toHaveAttribute('href','/organizations/org/opportunities/pipeline');
    expect(screen.getByRole('link',{name:'View calendar'})).toHaveAttribute('href','/organizations/org/sales/calendar');
    expect(screen.getByRole('button',{name:'Activity'})).toBeInTheDocument();
  });
  it('puts the month control on the panel it filters, beside forecast and win rate',()=>{
    render(<CrmHome {...defaults}/>);
    const month=panel('This month');
    expect(within(month).getByLabelText('Month for forecast and win rate')).toHaveValue('2026-10');
    expect(within(month).getByRole('link',{name:/CA\$1,250\.50/})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&closeFrom=2026-10-01&closeBefore=2026-11-01');
    expect(within(month).getByText('US$500.00')).toBeInTheDocument();
    expect(within(month).getByText('No opportunities closed this month')).toBeInTheDocument();
    expect(within(panel('Needs attention')).queryByLabelText(/Month/)).toBeNull();
  });
  it('keeps the pipeline to its stage strip, without repeating the opportunities list',()=>{
    render(<CrmHome {...defaults}/>);
    const pipeline=panel('Pipeline');
    const discovery=within(pipeline).getByRole('link',{name:/Discovery/});expect(discovery).toHaveAttribute('href','/organizations/org/opportunities?stage=s1');expect(discovery).toHaveTextContent('4');
    expect(within(pipeline).queryByRole('table')).toBeNull();
  });
  it('changes attention inline among exceptions only, and sends View all to the chosen collection',async()=>{
    render(<CrmHome {...defaults}/>);const user=userEvent.setup();
    expect(screen.getByText('Review overdue')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:/No next follow-up 5/}));
    expect(screen.getByRole('link',{name:'View all'})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&next=none');
    await user.click(screen.getByRole('button',{name:/Unassigned 2/}));
    expect(screen.getByRole('link',{name:'View all'})).toHaveAttribute('href','/organizations/org/opportunities?kind=open&owner=unassigned');
  });
  it('says once that nothing needs attention, without empty category tabs',()=>{
    render(<CrmHome {...defaults} summary={{...defaults.summary,overdue:0,noNext:0,unassigned:0}} overdue={[]}/>);
    expect(within(panel('Needs attention')).getByText('Nothing needs attention.')).toBeInTheDocument();
    expect(screen.queryByRole('group',{name:'Attention categories'})).toBeNull();
  });
  it('shows a new business one getting-started panel instead of a row of empty ones',()=>{
    render(<CrmHome {...defaults} mayCreate mayConfigure summary={{...defaults.summary,customers:0,open:0,today:0,overdue:0,noNext:0,unassigned:0,forecast:[]}} opportunitySummary={[]} today={[]} overdue={[]}/>);
    expect(screen.getByRole('heading',{name:'Get started with CRM'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Set up stages'})).toHaveAttribute('href','/organizations/org/sales/configuration/opportunity-stages');
    for(const name of ['Needs attention','Pipeline','Today','This month','Recent customers'])expect(screen.queryByRole('heading',{name})).toBeNull();
    expect(screen.queryByText(/Nothing|No customers yet|No opportunity stages/)).toBeNull();
  });
  it('keeps reduced roles read-only and hides disabled feature destinations',()=>{
    render(<CrmHome {...defaults} followUpsEnabled={false} conversionEnabled={false}/>);
    expect(screen.queryByRole('button',{name:'New customer'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'New opportunity'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'New follow-up'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Configure'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'View calendar'})).toHaveAttribute('href','/organizations/org/sales/calendar');expect(screen.queryByRole('button',{name:/No next follow-up/})).not.toBeInTheDocument();
  });
  it('offers canonical drawers only for authorized mutation and calculates real win rate',()=>{
    render(<CrmHome {...defaults} mayCreate mayCreateOpportunity mayConfigure configureItems={[{key:'sales-stages',label:'Relationship stages',href:'/organizations/org/sales/configuration/relationship-stages'},{key:'opportunity-stages',label:'Opportunity stages',href:'/organizations/org/sales/configuration/opportunity-stages'}]} followUpOptions={{...defaults.followUpOptions,mayManage:true}} summary={{...defaults.summary,won:3,lost:1}}/>);
    // Package 3A: several configuration doors are a Configure menu, never a link to the retired landing.
    for(const name of ['New customer','New opportunity','New follow-up'])expect(screen.getByRole('button',{name})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Configure'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'Configuration'})).toBeNull();expect(screen.getByText('75%')).toBeInTheDocument();
  });
});
