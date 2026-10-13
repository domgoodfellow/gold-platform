import { describe, expect, it } from 'vitest';
import { configurationRedirectHref, legacyConfigurationPath } from '@/lib/route/configuration-redirect';
describe('canonical configuration compatibility', () => {
 it.each([
  ['settings/calls','comms/configuration/calling'], ['settings/communications','comms/configuration/messaging'], ['settings/email','comms/configuration/email'], ['settings/sales-stages','sales/configuration/relationship-stages'], ['settings/opportunity-stages','sales/configuration/opportunity-stages'], ['settings/pricing','finance/configuration/pricing'], ['comms/numbers/number-id','comms/configuration/numbers/number-id'], ['support/service-levels','support/configuration/service-levels'],
 ])('resolves %s through its canonical registry owner', (old, canonical) => expect(legacyConfigurationPath(`/organizations/tenant/${old}`)).toBe(`/organizations/tenant/${canonical}`));
 it('keeps repeated query values and encodes arbitrary values', () => expect(configurationRedirectHref('tenant','comms/configuration/calling',{filter:['a','b'],q:'a&b',omit:undefined})).toBe('/organizations/tenant/comms/configuration/calling?filter=a&filter=b&q=a%26b'));
 it('does not redirect unrelated operating routes', () => expect(legacyConfigurationPath('/organizations/tenant/calls/call-id')).toBeNull());
});
