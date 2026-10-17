import { describe, expect, it } from 'vitest';
import { formatPhoneForDisplay } from '@/lib/display/phone';

describe('formatPhoneForDisplay', () => {
  it('groups a North American E.164 number for reading', () => {
    expect(formatPhoneForDisplay('+14165550176')).toBe('+1 416 555 0176');
  });

  it('leaves a number it does not recognise exactly as stored', () => {
    expect(formatPhoneForDisplay('+442079460000')).toBe('+442079460000');
    expect(formatPhoneForDisplay('555-0176')).toBe('555-0176');
  });

  it('trims surrounding space without regrouping an unrecognised value', () => {
    expect(formatPhoneForDisplay('  +442079460000 ')).toBe('+442079460000');
  });
});
