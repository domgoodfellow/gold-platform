import { describe,expect,it } from 'vitest';
import { dueFilter } from '@/lib/application/crm/follow-ups';
import { winRate } from '@/lib/application/crm/dashboard';
describe('CRM business dates and conversion',()=>{
  it('uses tenant midnight, including daylight-saving day length',()=>{
    expect(dueFilter('today','America/Toronto',new Date('2026-03-08T15:00:00Z'))).toEqual({from:'2026-03-08T05:00:00.000Z',before:'2026-03-09T04:00:00.000Z'});
    expect(dueFilter('today','America/Toronto',new Date('2026-10-08T02:00:00Z'))).toEqual({from:'2026-10-07T04:00:00.000Z',before:'2026-10-08T04:00:00.000Z'});
  });
  it('uses an instant cutoff for overdue and an honest undefined conversion',()=>{
    expect(dueFilter('overdue','Asia/Tokyo',new Date('2026-10-07T23:00:00Z'))).toEqual({before:'2026-10-07T23:00:00.000Z'});
    expect(winRate(0,0)).toBeNull();expect(winRate(0,3)).toBe(0);expect(winRate(3,1)).toBe(0.75);
  });
});
