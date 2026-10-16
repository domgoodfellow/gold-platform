import { describe, expect, it } from 'vitest';
import { layoutTimeBlocks } from '@/components/calendar/calendar-time-layout';
describe('calendar time blocks', () => {
  const from = Date.parse('2026-10-16T00:00:00Z'), before = from + 24 * 3600000;
  const event = (key: string, start: number, end: number) => ({ key, startsAt: new Date(from + start * 3600000).toISOString(), endsAt: new Date(from + end * 3600000).toISOString() });
  it('gives simultaneous events independent columns and reuses columns after they end', () => {
    const blocks = layoutTimeBlocks([event('one', 9, 11), event('two', 10, 12), event('three', 11, 12), event('four', 13, 14)], from, before);
    expect(blocks.map(block => [block.key, block.column, block.columns])).toEqual([['one',0,2],['two',1,2],['three',0,2],['four',0,1]]);
  });
  it('clips overnight intervals to the selected day and treats adjacent events as non-overlapping', () => {
    const blocks = layoutTimeBlocks([event('overnight', -2, 1),event('next',1,2),event('tomorrow',24,25)], from, before);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ start: from, columns: 1 });
    expect(blocks[1].columns).toBe(1);
  });
});
