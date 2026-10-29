import { describe, expect, it } from 'vitest';
import { emptySource, homePeriod, homeQuery, type HomeAttentionItem, type HomeData } from '@/lib/application/home/contracts';
import { homePresentation } from '@/lib/application/home/presentation';
import { upcomingWindow, shiftDate, zonedDayRange } from '@/lib/domain/scheduling/window';

const item = (id: string): HomeAttentionItem => ({ key:`Work:work-item:${id}`,organizationId:'org',source:'Work',category:'work',record:{kind:'work-item',id},title:id,description:'',urgency:'high',overdue:false,destination:{href:'/work/'+id,label:'Open'} });
function data(): HomeData {
  const source=emptySource('Work');
  return { organizationId:'org',membershipId:'member',date:'2026-10-28',timezone:'America/Toronto',refreshedAt:'2026-10-28T15:00:00Z',query:homeQuery({}),period:homePeriod('2026-10-28','America/Toronto','today'),results:[{source:'Work',state:'ready',data:source}],kpis:[],quickActions:[],search:[],agentPrompts:[] };
}
describe('Home H1 presentation contracts',()=>{
  it('normalizes the URL-backed obligation period without changing attention or reporting',()=>{
    expect(homeQuery({schedule:'upcoming',scope:'mine',when:'month'})).toMatchObject({schedule:'upcoming',scope:'mine',when:'month'});
    expect(homeQuery({schedule:['upcoming']})).toMatchObject({schedule:'today'});
  });
  for(const [date,hours] of [['2026-03-06',167],['2026-10-30',169]] as const) it(`keeps all seven future local dates across DST after ${date}`,()=>{
    const window=upcomingWindow(date,'America/Toronto');
    expect(window.startsAt).toBe(zonedDayRange(date,'America/Toronto').endsAt);
    expect(window.endsAt).toBe(zonedDayRange(shiftDate(date,7),'America/Toronto').endsAt);
    expect((Date.parse(window.endsAt)-Date.parse(window.startsAt))/3600000).toBe(hours);
  });
  it('uses attention, then distinct priorities, then distinct obligations without deduplicating similar titles',()=>{
    const d=data(),source=d.results[0];if(source.state!=='ready')throw Error();
    const a=item('attention'),b=item('priority'),c=item('other');
    source.data.attention=[a];source.data.priorities=[a,b];
    const obligation=(row:HomeAttentionItem)=>({key:row.key,source:row.source,title:'Same title',at:'2026-10-28T15:00:00Z',context:'',owner:'',href:row.destination.href});
    source.data.today=[a,b,c].map(obligation);source.data.upcoming=[obligation(c),{...obligation(item('future')),at:'2026-10-29T15:00:00Z'}];
    const p=homePresentation(d);
    expect(p.attention.map(r=>r.key)).toEqual([a.key]);expect(p.mine.map(r=>r.key)).toEqual([b.key]);
    expect(p.today.map(r=>r.key)).toEqual([c.key]);expect(p.upcoming.map(r=>r.key)).toEqual([item('future').key]);
  });
  it('retains the newest activity per record and does not repeat an operational record already displayed',()=>{
    const d=data(),source=d.results[0];if(source.state!=='ready')throw Error();
    source.data.attention=[item('a')];
    source.data.activity=[{key:'1',source:'Work',title:'old',at:'2026-10-28T10:00:00Z',href:'/work/b',recordKey:'b'},{key:'2',source:'Work',title:'new',at:'2026-10-28T11:00:00Z',href:'/work/b',recordKey:'b'},{key:'3',source:'Work',title:'attention event',at:'2026-10-28T12:00:00Z',href:'/work/a',recordKey:item('a').key}];
    expect(homePresentation(d).activity.map(r=>r.title)).toEqual(['new']);
  });
});
