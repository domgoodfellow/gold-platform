import { describe, expect, it } from 'vitest';
import { formatPhoneForDisplay } from '@/lib/display/phone';

describe('formatPhoneForDisplay', () => {
  it('groups a North American E.164 number for reading', () => {
    expect(formatPhoneForDisplay('+14165550176')).toBe('(416)555-0176');
  });

  it.each(['4165550176', '14165550176', '416-555-0176', '(416) 555-0176', '+1 (416) 555-0176'])('formats the complete North American number %s', (value) => {
    expect(formatPhoneForDisplay(value)).toBe('(416)555-0176');
  });

  it('leaves a number it does not recognise exactly as stored', () => {
    expect(formatPhoneForDisplay('+442079460000')).toBe('+442079460000');
    expect(formatPhoneForDisplay('555-0176')).toBe('555-0176');
    expect(formatPhoneForDisplay('+141655501760')).toBe('+141655501760');
    expect(formatPhoneForDisplay('4165550176 ext 23')).toBe('4165550176 ext 23');
    expect(formatPhoneForDisplay('')).toBe('');
  });

  it('trims surrounding space without regrouping an unrecognised value', () => {
    expect(formatPhoneForDisplay('  +442079460000 ')).toBe('+442079460000');
  });
});
