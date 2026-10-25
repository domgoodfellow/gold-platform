import { describe, expect, it } from 'vitest';
import { LEGACY_TABS, SECTION_VIEWS, recordHref, resolveRecordLocation, type Availability } from '@/features/crm/customers/record-sections';

const everything: Availability = {
  sections: ['overview', 'sales', 'tasks', 'activity', 'related', 'documents', 'portal'],
  views: { sales: ['opportunities', 'discovery', 'configuration', 'commercial', 'invoices'], activity: ['timeline', 'calls'], related: ['work', 'locations', 'support', 'services'] },
};

describe('contact record section mapping', () => {
  it('keeps every former tab reachable at a stable new place', () => {
    const before = ['overview', 'opportunities', 'follow-ups', 'discovery', 'configuration', 'commercial', 'activity', 'work', 'locations', 'calls', 'documents', 'invoices', 'portal', 'support'];
    for (const tab of before) {
      const mapped = LEGACY_TABS[tab];
      expect(mapped, tab).toBeDefined();
      expect(resolveRecordLocation({ tab }, everything)).toEqual({ section: mapped.section, view: mapped.view ?? SECTION_VIEWS[mapped.section][0] });
    }
    expect(resolveRecordLocation({ tab: 'calls' }, everything)).toEqual({ section: 'activity', view: 'calls' });
    expect(resolveRecordLocation({ tab: 'work' }, everything)).toEqual({ section: 'related', view: 'work' });
  });
  it('never opens a section or view the viewer cannot, and falls back predictably', () => {
    const limited: Availability = { sections: ['overview', 'sales', 'activity', 'related', 'documents'], views: { sales: ['opportunities'], activity: ['timeline'], related: ['work', 'locations'] } };
    expect(resolveRecordLocation({ section: 'portal' }, limited)).toEqual({ section: 'overview', view: undefined });
    expect(resolveRecordLocation({ section: 'sales', view: 'commercial' }, limited)).toEqual({ section: 'sales', view: 'opportunities' });
    expect(resolveRecordLocation({ tab: 'calls' }, limited)).toEqual({ section: 'activity', view: 'timeline' });
    expect(resolveRecordLocation({}, limited)).toEqual({ section: 'overview', view: undefined });
  });
  it('builds linkable addresses, with Overview at the record address itself', () => {
    expect(recordHref('/c', 'overview')).toBe('/c');
    expect(recordHref('/c', 'related', 'locations')).toBe('/c?section=related&view=locations');
    expect(recordHref('/c', 'tasks')).toBe('/c?section=tasks');
  });
});
