import { describe, expect, it } from 'vitest';
import { configurationRedirectHref, legacyConfigurationPath } from '@/lib/route/configuration-redirect';
describe('canonical configuration compatibility', () => {
 it.each([
  ['settings/calls','comms/configuration/calling'], ['settings/communications','comms/configuration/messaging'], ['settings/sales-stages','crm/configuration/relationship-stages'], ['settings/opportunity-stages','crm/configuration/opportunity-stages'], ['settings/pricing','finance/configuration/pricing'], ['comms/numbers/number-id','comms/configuration/numbers/number-id'],
 ])('resolves %s through its canonical registry owner', (old, canonical) => expect(legacyConfigurationPath(`/organizations/tenant/${old}`)).toBe(`/organizations/tenant/${canonical}`));
 it('keeps repeated query values and encodes arbitrary values', () => expect(configurationRedirectHref('tenant','comms/configuration/calling',{filter:['a','b'],q:'a&b',omit:undefined})).toBe('/organizations/tenant/comms/configuration/calling?filter=a&filter=b&q=a%26b'));
 it('does not redirect unrelated operating routes', () => expect(legacyConfigurationPath('/organizations/tenant/calls/call-id')).toBeNull());
 // Phase 3B: Email sending is canonical in Settings; Communications keeps its own Inbox email page.
 it('serves Email sending and Inbox email where they are, without redirecting either', () => {
  expect(legacyConfigurationPath('/organizations/tenant/settings/email')).toBeNull();
  expect(legacyConfigurationPath('/organizations/tenant/comms/configuration/email')).toBeNull();
 });
 it('leaves Support service levels to its operating view, not configuration', () => expect(legacyConfigurationPath('/organizations/tenant/support/service-levels')).toBeNull());
});
