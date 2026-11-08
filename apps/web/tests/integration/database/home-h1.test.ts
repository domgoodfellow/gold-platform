import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/types';
import { foundBusiness } from '@/tests/support/founding';
import { grantHomeVerificationPlan } from '@/tests/support/home-fixture';
import { seedH1, H1_ZONE } from '@/tests/support/home-h1-fixture';
import { loadHome } from '@/lib/application/home/load';
import { homePresentation } from '@/lib/application/home/presentation';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { setWorkItemResources } from '@/lib/domain/scheduling/schedule';
import { workOperations } from '@/lib/application/work/operations';
import { listTasks } from '@/lib/domain/tasks/tasks';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { readFinanceSummary, readFinanceInvoices } from '@/lib/domain/billing/finance-reads';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { shiftDate, zonedDayRange } from '@/lib/domain/scheduling/window';

const url = process.env.SUPABASE_URL!;
if (!['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw Error('Disposable local Home tests only');
async function actor() {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `h1-${randomUUID()}@example.test`, password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as Db;
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { db, email };
}
let owner: Awaited<ReturnType<typeof actor>>, reader: typeof owner, outsider: typeof owner;
let fixture: Awaited<ReturnType<typeof seedH1>>;
const home = async (query = {}, db = owner.db) => loadHome(db, (await getOrganization(db, fixture.organizationId)) ?? (await getOrganization(owner.db, fixture.organizationId))!, query);
const sources = (data: Awaited<ReturnType<typeof loadHome>>) => data.results.flatMap(r => r.state === 'ready' ? [r.data] : []);

describe('Home H1 reconciles existing workspace authorities', () => {
  beforeAll(async () => {
    owner = await actor(); reader = await actor(); outsider = await actor();
    const id = await foundBusiness({ ownerEmail: owner.email, name: 'H1 reconciliation', currency: 'CAD', timezone: H1_ZONE });
    await grantHomeVerificationPlan(id);
    fixture = await seedH1(owner.db, id, 'mixed');
    const roleId = await createRole(owner.db, { organizationId: id, name: 'H1 reader', capabilities: [] });
    await addMember(owner.db, { organizationId: id, email: reader.email, roleId });
  }, 120_000);
  it('matches complete W3 counts and surfaces a conflict beyond the first five scheduled records', async () => {
    const data = await home(), work = sources(data).find(s => s.source === 'Work')!;
    const canonical = await workOperations(owner.db, fixture.organizationId, fixture.date, H1_ZONE);
    expect(work.metrics[0].value).toBe(canonical.todayCount);
    expect(work.categories.find(c => c.key === 'work-conflict')?.total).toBe(canonical.conflicts.total);
    expect(work.categories.find(c => c.key === 'work-shortfall')?.total).toBe(canonical.shortfalls.total);
    const conflict = work.attention.find(row => row.record.id === fixture.ids.lateConflict)!;
    expect(conflict.description).toContain('unavailable');
    expect(conflict.destination.href).toContain(`/work/dispatch?on=${fixture.date}&selected=${fixture.ids.lateConflict}`);
    expect(canonical.today.map(w => w.id)).not.toContain(fixture.ids.lateConflict);
  });
  it('uses seven future local dates, excludes the eighth and places continuing work only under Today', async () => {
    const rows = sources(await home()), work = rows.find(s => s.source === 'Work')!, crm = rows.find(s => s.source === 'CRM')!;
    expect(work.upcoming.map(row => row.title)).toContain('H1 daySeven');
    expect(work.upcoming.map(row => row.title)).not.toContain('H1 dayEight');
    expect(work.upcoming.map(row => row.title)).not.toContain('H1 overnight');
    expect(work.today.find(row => row.title === 'H1 continuing')?.continuing).toBe(true);
    expect(work.today.find(row => row.title === 'H1 allDay')?.allDay).toBe(true);
    expect(work.today.some(row => work.upcoming.some(next => next.key === row.key))).toBe(false);
    expect(crm.upcoming.map(row => row.title)).toContain('Seventh-day follow-up');
    expect(crm.upcoming.map(row => row.title)).not.toContain('Eighth-day follow-up');
    const expected = await listTasks(owner.db, { organizationId: fixture.organizationId, status: 'open', from: zonedDayRange(shiftDate(fixture.date,1),H1_ZONE).startsAt, before: zonedDayRange(shiftDate(fixture.date,8),H1_ZONE).startsAt });
    expect(crm.obligationTotals?.upcoming).toBe(expected.total);
  });
  it('shows each canonical record once across attention, responsibilities and dated obligations', async () => {
    const projected = homePresentation(await home());
    const keys = [...projected.attention, ...projected.mine, ...projected.today, ...projected.upcoming].map(row => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(projected.attention.find(row => row.record.id === fixture.ids.unscheduled)?.description).toContain('Unscheduled; availability not assessed');
  });
  it('reconciles receivables, overdue invoices and signed payments without mixing them', async () => {
    const data = await home({ when: 'week' }), finance = sources(data).find(s => s.source === 'Finance')!;
    const summary = await readFinanceSummary(owner.db,fixture.organizationId,data.period.from,data.period.to);
    const overdue = await readFinanceInvoices(owner.db,fixture.organizationId,{status:'overdue'});
    expect(finance.metrics[0].value).toBe(overdue.total);
    expect(overdue.rows.map(row=>row.id)).toEqual([fixture.ids.invoice]);
    for (const row of summary.received) expect(finance.performance.find(m=>m.key===`Payments recorded:${row.currency}`)?.value).toBe(formatMoney(Number(row.amount),row.currency));
    for (const row of summary.outstanding) expect(finance.performance.find(m=>m.key===`Outstanding invoices:${row.currency}`)?.value).toBe(formatMoney(Number(row.amount),row.currency));
    expect(finance.trends.flatMap(t=>t.points).some(point=>point.amountMinor<0)).toBe(true);
    expect(finance.attention[0].destination.href).toContain(`/finance/invoices?invoice=${fixture.ids.invoice}`);
  });
  it('labels the CRM count Contacts and keeps overview metrics independent of attention and reporting choices', async () => {
    const all = await home(), mine = await home({scope:'mine'}), month = await home({when:'month'});
    expect(mine.kpis).toEqual(all.kpis); expect(month.kpis).toEqual(all.kpis);
    const contacts = await listContacts(owner.db,{organizationId:fixture.organizationId,limit:1});
    expect(sources(all).find(s=>s.source==='CRM')?.performance[0]).toMatchObject({label:'Contacts',value:contacts.total});
    expect(homePresentation(await home({attention:'overdue'})).attention.every(row=>row.overdue)).toBe(true);
    expect(homePresentation(await home({attention:'urgent'})).attention.every(row=>row.urgency!=='normal')).toBe(true);
  });
  it('omits restricted financial values and actions and denies nonmembers before source reads', async () => {
    const data = await home({},reader.db);
    expect(data.results.map(r=>r.source)).toEqual(['CRM','Work']);
    expect(data.quickActions).toEqual([]);
    expect(data.kpis.some(m=>m.key==='overdue-invoices')).toBe(false);
    expect(JSON.stringify(data)).not.toContain('Payments recorded');
    await expect(home({},outsider.db)).rejects.toThrow('membership');
  });
  it('isolates Work shape and resource prerequisite failures without taking down CRM or Finance', async () => {
    for (const failing of ['work_item_types','resources']) {
      const broken = new Proxy(owner.db, { get(target,key,receiver) { if(key==='from') return (table:string)=>target.from((table===failing?'__h1_source_fault':table) as never); return Reflect.get(target,key,receiver); } });
      const data = await home({},broken);
      expect(data.results.find(r=>r.source==='Work')?.state).toBe('unavailable');
      expect(data.results.find(r=>r.source==='CRM')?.state).toBe('ready');
      expect(data.results.find(r=>r.source==='Finance')?.state).toBe('ready');
      expect(data.kpis.some(m=>m.key==='scheduled')).toBe(false);
    }
  });
  it('distinguishes unscheduled staffing gaps from assessed availability', async () => {
    await setWorkItemResources(owner.db,{workItemId:fixture.ids.unscheduled,resourceIds:[]});
    try {
      const work=sources(await home()).find(source=>source.source==='Work')!;
      const row=work.attention.find(item=>item.record.id===fixture.ids.unscheduled)!;
      expect(row.description).toContain('Not yet staffed');
      expect(row.description).toContain('availability not assessed');
      expect(row.description).not.toContain('unavailable');
    } finally { await setWorkItemResources(owner.db,{workItemId:fixture.ids.unscheduled,resourceIds:[fixture.ids.resource]}); }
  });
  it('keeps uncertain deliveries distinct from failed delivery facts and uses exact source filters', async () => {
    const pg=new Client(process.env.SUPABASE_DB_URL!);await pg.connect();
    const ids:string[]=[];
    try {
      for(const state of ['failed','uncertain']) {
        const row=await pg.query("insert into public.message_deliveries(organization_id,rule_id,rule_name,subject_type,subject_id,channel,recipient,body,state,detail) values($1,$2,$3,'work_item',$4,'sms','+14165550101','Local metadata fixture',$5,'Controlled local state') returning id",[fixture.organizationId,randomUUID(),`H1 ${state} delivery`,fixture.ids.unscheduled,state]);
        ids.push(row.rows[0].id);
      }
      const automation=sources(await home()).find(source=>source.source==='Automations')!;
      expect(automation.categories.find(category=>category.key==='delivery')).toMatchObject({total:1,href:expect.stringContaining('state=failed')});
      expect(automation.categories.find(category=>category.key==='uncertain-delivery')).toMatchObject({total:1,href:expect.stringContaining('state=uncertain')});
      expect(automation.attention.find(row=>row.record.id===ids[1])?.description).toBe('Text not confirmed');
      expect(automation.attention.find(row=>row.record.id===ids[0])?.description).toBe('Text not delivered');
      expect(automation.activity.find(row=>row.recordKey===`Automations:delivery:${ids[1]}`)?.title).toContain('Delivery not confirmed');
    } finally { if(ids.length)await pg.query('delete from public.message_deliveries where id=any($1::uuid[])',[ids]);await pg.end(); }
  });
  it('keeps healthy metrics when recent activity fails and keeps source failures unknown', async () => {
    const broken = new Proxy(owner.db, { get(target,key,receiver) { if(key==='from') return (table:string)=>target.from((table==='events'?'__h1_activity_fault':table) as never); return Reflect.get(target,key,receiver); } });
    const data = await home({},broken);
    expect(data.results.every(r=>r.state==='ready')).toBe(true);
    expect(data.kpis.find(m=>m.key==='scheduled')?.value).toBe(10);
    expect(sources(data).find(s=>s.source==='Work')?.health.some(h=>h.key.endsWith('activity-unavailable'))).toBe(true);
  });
});
