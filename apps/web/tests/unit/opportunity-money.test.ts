import { describe, expect, it } from 'vitest';
import { parseOpportunityValue, formatOpportunityValue, opportunityValueInput } from '@/lib/domain/opportunities/money';
describe('opportunity value precision', () => {
  it('distinguishes unknown from zero and respects currency minor units', () => {
    expect(parseOpportunityValue('', '')).toBeNull();
    expect(parseOpportunityValue('0', 'CAD')).toBe(0);
    expect(parseOpportunityValue('10.01', 'CAD')).toBe(1001);
    expect(parseOpportunityValue('10', 'JPY')).toBe(10);
    expect(parseOpportunityValue('1.234', 'KWD')).toBe(1234);
    expect(() => parseOpportunityValue('10.01', 'JPY')).toThrow();
    expect(() => parseOpportunityValue('1.001', 'CAD')).toThrow();
    expect(() => parseOpportunityValue('-1', 'CAD')).toThrow();
    expect(() => parseOpportunityValue('1', '')).toThrow();
  });
  it('renders aggregate values above safe integer without rounding', () => {
    expect(formatOpportunityValue('18014398509481982', 'USD')).toBe('US$180,143,985,094,819.82');
    expect(opportunityValueInput(1001, 'CAD')).toBe('10.01');
    expect(opportunityValueInput(null, null)).toBe('');
    expect(() => parseOpportunityValue('90071992547409.92', 'CAD')).toThrow();
  });
});
