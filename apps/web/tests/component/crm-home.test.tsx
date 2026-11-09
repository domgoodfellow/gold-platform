// @vitest-environment jsdom
import { cleanup,render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { CrmHome,type CrmHomeProps } from '@/features/crm/home/crm-home';
import type { RelationshipRow } from '@/lib/domain/contacts/relationship-activity';
vi.mock('@/features/crm/intake/contact-intake',()=>({AddContactsTrigger:()=> <button>Add contacts</button>}));
vi.mock('@/features/crm/opportunities/opportunity-sheet',()=>({OpportunitySheet:()=> <button>New opportunity</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-sheet',()=>({FollowUpSheet:({children,item}:{children?:string;item?:unknown})=><button>{children??(item?'Edit task':'New task')}</button>}));
vi.mock('@/features/crm/follow-ups/follow-up-list',()=>({FollowUpList:({items}:{items:{title:string}[]})=><ul>{items.map(item=><li key={item.title}>{item.title}</li>)}</ul>}));
vi.mock('@/components/panels/workspace-right-rail',()=>({SupportTrigger:({mode}:{mode:string})=> <button>{mode==='activity'?'Activity':mode==='insights'?'Insights':'Settings'}</button>}));
const row=(id:string,name:string,contactType:RelationshipRow['contactType'],extra:Partial<RelationshipRow>={}):RelationshipRow=>({id,name,contactType,lifecycle:null,companyId:null,companyName:null,activity:{action:'follow_up.completed',detail:{kind:'call',title:`Call ${name}`},occurredAt:'2026-10-20T15:00:00Z'},nextTask:null,...extra});
const rows=[row('p1','Ada Person','person',{companyId:'c1',companyName:'Acme Ltd',lifecycle:'prospect',nextTask:{id:'t1',title:'Send proposal',dueAt:'2026-10-25T15:00:00Z'}}),row('c1','Acme Ltd','company',{lifecycle:'customer'}),row('p2','Ben Person','person',{companyId:'c1',companyName:'Acme Ltd'}),row('p3','Cy Solo','person')];
const stage={stageId:'s1',name:'Discovery',kind:'open',position:0,count:4,values:[]};
const summary={customers:12,open:8,today:3,overdue:1,noNext:5,unassigned:2,forecast:[{currency:'CAD',amount_minor:'125050'},{currency:'USD',amount_minor:'50000'}],pipeline:[{currency:'CAD',amount_minor:'900000'}],won:0,lost:0};
const defaults:CrmHomeProps={organizationId:'org',timezone:'America/Toronto',month:'2026-10-01',
  overview:{total:12,people:7,companies:3,unspecified:2,newLast30Days:4,lifecycles:{lead:5,prospect:3,customer:2,unclassified:2}},
  relationships:{rows,mode:'active',grouped:false},sales:{summary,stages:[stage,{stageId:null,name:'Unstaged',kind:null,position:null,count:2,values:[]}]} as CrmHomeProps['sales'],salesComposition:'full',
  attention:{overdue:1,today:1,noNext:5,unassigned:2},today:[{id:'today',title:'Call today'}] as CrmHomeProps['today'],overdue:[{id:'overdue',title:'Review overdue'}] as CrmHomeProps['overdue'],noNext:[{id:'o1',title:'Quiet deal',customerName:'Acme',stage:null}] as CrmHomeProps['noNext'],unassigned:[{id:'o2',title:'Nobody deal',customerName:'Acme',stage:null}] as CrmHomeProps['unassigned'],
  followUpOptions:{organizationId:'org',timezone:'America/Toronto',members:[],mayManage:false},opportunityOptions:{organizationId:'org',stages:[],members:[],defaultCurrency:'CAD'},followUpsEnabled:true,conversionEnabled:true,mayAddContacts:false,mayCreateOpportunity:false,mayConfigure:false};
const relationshipOnly:Partial<CrmHomeProps>={sales:null,salesComposition:'hidden',attention:{overdue:0,today:0,noNext:0,unassigned:0},today:[],overdue:[],noNext:[],unassigned:[]};
beforeEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }); });
afterEach(cleanup);
const panel=(name:string)=>screen.getByRole('region',{name});
describe('relationship-first CRM dashboard',()=>{
  it('opens with the relationship overview: People, Companies and Unspecified, new contacts and an independent lifecycle distribution',()=>{
    render(<CrmHome {...defaults}/>);
    const overview=panel('Relationship overview');
    expect(within(overview).getByText('12')).toBeInTheDocument();
    expect(within(overview).getByRole('link',{name:'7 people'})).toHaveAttribute('href','/organizations/org/crm/contacts?contactType=person');
    expect(within(overview).getByRole('link',{name:'3 companies'})).toHaveAttribute('href','/organizations/org/crm/contacts?contactType=company');
    expect(within(overview).getByRole('link',{name:'2 unspecified'})).toHaveAttribute('href','/organizations/org/crm/contacts?contactType=unspecified');
    expect(within(overview).getByRole('link',{name:/New contacts 4 Records added in the last 30 days/})).toHaveAttribute('href','/organizations/org/crm/contacts?added=30d');
    const lifecycles=within(overview).getByRole('list',{name:'Contacts by lifecycle'});
    expect(within(lifecycles).getByRole('link',{name:'Leads 5'})).toHaveAttribute('href','/organizations/org/crm/contacts?lifecycle=lead');
    expect(within(lifecycles).getByRole('link',{name:'Unclassified 2'})).toHaveAttribute('href','/organizations/org/crm/contacts?lifecycle=unclassified');
    // Reading order: overview, relationships, attention, then sales.
    const order=screen.getAllByRole('region').map(r=>r.getAttribute('aria-label'));
    expect(order.slice(0,4)).toEqual(['Relationship overview','Recently active relationships','Needs attention','Opportunities & Pipeline']);
  });
  it('hides Unspecified when there are none',()=>{
    render(<CrmHome {...defaults} overview={{...defaults.overview,unspecified:0}}/>);
    expect(screen.queryByRole('link',{name:/unspecified/})).toBeNull();
  });
  it('lists people and companies as independent rows with their latest interaction and only real next tasks',()=>{
    render(<CrmHome {...defaults}/>);
    const recent=panel('Recently active relationships');
    expect(within(recent).getByRole('link',{name:'Ada Person'})).toHaveAttribute('href','/organizations/org/crm/contacts/p1');
    expect(within(recent).getByRole('link',{name:'Acme Ltd'})).toHaveAttribute('href','/organizations/org/crm/contacts/c1');
    // V1.4: identity and affiliation on the secondary line; lifecycle as a labelled status.
    expect(within(recent).getAllByText('Person · Acme Ltd')).toHaveLength(2);
    expect(within(recent).getByLabelText('Ada Person stage')).toHaveTextContent('StageProspect');
    expect(within(recent).getByLabelText('Acme Ltd stage')).toHaveTextContent('StageCustomer');
    expect(within(recent).getByText('Call task completed: Call Ada Person')).toBeInTheDocument();
    expect(within(recent).getAllByText(/^Next:/)).toHaveLength(1);
  });
  it('labels the no-activity fallback as Recently added contacts, never as activity',()=>{
    render(<CrmHome {...defaults} relationships={{rows:rows.map(r=>({...r,activity:null,createdAt:'2026-10-01T12:00:00Z'})),mode:'added',grouped:false}}/>);
    expect(screen.getByRole('region',{name:'Recently added contacts'})).toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Recently active relationships'})).toBeNull();
    expect(screen.getByText('No relationship activity yet. Showing newest contacts.')).toBeInTheDocument();
    expect(screen.queryByText(/task completed/)).toBeNull();
  });
  it('groups by company from a URL-backed control without repeating any person',()=>{
    const {unmount}=render(<CrmHome {...defaults}/>);
    expect(screen.getByRole('link',{name:'Group by company'})).toHaveAttribute('href','/organizations/org/crm?month=2026-10&group=company');
    unmount();
    render(<CrmHome {...defaults} relationships={{rows,mode:'active',grouped:true}}/>);
    expect(screen.getByRole('link',{name:'All'})).toHaveAttribute('href','/organizations/org/crm?month=2026-10');
    expect(screen.getByRole('link',{name:'Group by company'})).toHaveAttribute('aria-current','true');
    const groups=within(screen.getByRole('list',{name:'Grouped by company'})).getAllByRole('listitem').filter(li=>li.parentElement?.getAttribute('aria-label')==='Grouped by company');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText('Ada Person')).toBeInTheDocument();expect(within(groups[0]).getByText('Ben Person')).toBeInTheDocument();
    expect(within(groups[1]).getByText('No company')).toBeInTheDocument();expect(within(groups[1]).getByText('Cy Solo')).toBeInTheDocument();
    for(const name of ['Ada Person','Ben Person','Cy Solo'])expect(screen.getAllByRole('link',{name})).toHaveLength(1);
  });
  it('lists Overdue and Due today as separate exception categories, each task once',async()=>{
    render(<CrmHome {...defaults}/>);const user=userEvent.setup();
    const attention=panel('Needs attention');
    expect(within(attention).getByText('Review overdue')).toBeInTheDocument();expect(within(attention).queryByText('Call today')).toBeNull();
    await user.click(within(attention).getByRole('button',{name:/Due today 1/}));
    expect(within(attention).getByText('Call today')).toBeInTheDocument();expect(within(attention).queryByText('Review overdue')).toBeNull();
    await user.click(within(attention).getByRole('button',{name:/Unassigned 2/}));
    expect(within(attention).getByRole('link',{name:'View all'})).toHaveAttribute('href','/organizations/org/crm/opportunities?kind=open&owner=unassigned');
  });
  it('replaces an empty attention panel with one compact all-clear line',()=>{
    render(<CrmHome {...defaults} attention={{overdue:0,today:0,noNext:0,unassigned:0}} overdue={[]} today={[]}/>);
    expect(screen.queryByRole('region',{name:'Needs attention'})).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Needs attention: nothing overdue or due today, and every open opportunity has an owner.');
  });
  it('drops task categories when follow-ups are off and has no attention at all without tasks or sales',()=>{
    const {unmount}=render(<CrmHome {...defaults} followUpsEnabled={false}/>);
    expect(within(panel('Needs attention')).queryByRole('button',{name:/Overdue|Due today|No next action/})).toBeNull();
    expect(within(panel('Needs attention')).getByText(/Unassigned/)).toBeInTheDocument();
    unmount();
    render(<CrmHome {...defaults} {...relationshipOnly} followUpsEnabled={false}/>);
    expect(screen.queryByRole('region',{name:'Needs attention'})).toBeNull();expect(screen.queryByRole('status')).toBeNull();
  });
  it('gives a relationship-focused business a complete dashboard with no sales module',()=>{
    render(<CrmHome {...defaults} {...relationshipOnly} mayCreateOpportunity/>);
    expect(screen.getByRole('region',{name:'Relationship overview'})).toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Recently active relationships'})).toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Opportunities & Pipeline'})).toBeNull();
    expect(screen.queryByText(/Win rate|pipeline value|Unassigned/i)).toBeNull();
    expect(screen.queryByRole('button',{name:'New opportunity'})).toBeNull();
  });
  it('offers compact stage setup only to members who may configure it',()=>{
    render(<CrmHome {...defaults} {...relationshipOnly} salesComposition="setup" mayConfigure/>);
    const setup=panel('Opportunities & Pipeline');
    expect(within(setup).getByRole('link',{name:'Set up opportunity stages'})).toHaveAttribute('href','/organizations/org/crm/configuration/opportunity-stages');
    expect(within(setup).getByText(/CRM works without them/)).toBeInTheDocument();
    expect(within(setup).queryByText(/Win rate/)).toBeNull();
  });
  it('keeps stage, unweighted expected closes, win-rate and per-currency semantics in the sales section',()=>{
    render(<CrmHome {...defaults}/>);
    const sales=panel('Opportunities & Pipeline');
    expect(within(sales).getByLabelText('Month for expected closes and win rate')).toHaveValue('2026-10');
    expect(within(sales).getByRole('link',{name:/CA\$1,250\.50/})).toHaveAttribute('href','/organizations/org/crm/opportunities?kind=open&closeFrom=2026-10-01&closeBefore=2026-11-01');
    expect(within(sales).getByText('US$500.00')).toBeInTheDocument();
    expect(within(sales).getByText(/unweighted/)).toBeInTheDocument();
    expect(within(sales).getByText('No opportunities closed in the selected month')).toBeInTheDocument();
    expect(within(sales).getByRole('link',{name:'8'})).toHaveAttribute('href','/organizations/org/crm/opportunities?kind=open');
    expect(within(sales).getByRole('link',{name:'2 unstaged'})).toHaveAttribute('href','/organizations/org/crm/opportunities?stage=unstaged');
    const discovery=within(sales).getByRole('link',{name:/Discovery/});expect(discovery).toHaveAttribute('href','/organizations/org/crm/opportunities?stage=s1');
    expect(within(sales).queryByRole('table')).toBeNull();
    expect(screen.getByRole('link',{name:'View pipeline'})).toHaveAttribute('href','/organizations/org/crm/pipeline');
  });
  it('calculates real win rate only when conversion tracking is available',()=>{
    const {unmount}=render(<CrmHome {...defaults} sales={{...defaults.sales!,summary:{...summary,won:3,lost:1}}}/>);
    expect(screen.getByText('75%')).toBeInTheDocument();expect(screen.getByText('3 won of 4 closed')).toBeInTheDocument();
    unmount();render(<CrmHome {...defaults} conversionEnabled={false}/>);
    expect(within(panel('Opportunities & Pipeline')).getByText('Unavailable')).toBeInTheDocument();
  });
  it('keeps the normal structure for a new organization, with add and Library import entry points',()=>{
    render(<CrmHome {...defaults} {...relationshipOnly} salesComposition="setup" mayAddContacts mayConfigure overview={{total:0,people:0,companies:0,unspecified:0,newLast30Days:0,lifecycles:{lead:0,prospect:0,customer:0,unclassified:0}}} relationships={{rows:[],mode:'active',grouped:false}}/>);
    expect(screen.queryByRole('heading',{name:'Get started with CRM'})).toBeNull();
    expect(screen.getByRole('region',{name:'Relationship overview'})).toBeInTheDocument();
    const recent=panel('Recently active relationships');
    expect(within(recent).getByText(/No contacts yet/)).toBeInTheDocument();
    // One entry point: importing and synchronizing are choices inside the Add contacts dialog, not separate buttons.
    expect(within(recent).getAllByRole('button',{name:'Add contacts'})).toHaveLength(1);
    expect(within(recent).queryByRole('link',{name:/Import/})).toBeNull();
    expect(within(recent).queryByRole('navigation',{name:'Relationship grouping'})).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('nothing overdue or due today');
  });
  it('keeps reduced roles read-only',()=>{
    render(<CrmHome {...defaults}/>);
    for(const name of ['Add contacts','New opportunity','New task','Settings'])expect(screen.queryByRole('button',{name})).toBeNull();
    expect(screen.getByRole('button',{name:'Activity'})).toBeInTheDocument();
  });
  it('offers canonical drawers and configuration only for authorized mutation',()=>{
    render(<CrmHome {...defaults} mayAddContacts mayCreateOpportunity mayConfigure configureItems={[{key:'sales-stages',label:'Relationship stages',href:'/organizations/org/crm/configuration/relationship-stages'},{key:'opportunity-stages',label:'Opportunity stages',href:'/organizations/org/crm/configuration/opportunity-stages'}]} followUpOptions={{...defaults.followUpOptions,mayManage:true}}/>);
    for(const name of ['Add contacts','New opportunity','New task','Settings'])expect(screen.getByRole('button',{name})).toBeInTheDocument();
  });
});
