import { BrandMark } from '@/components/display/brand-mark';

/**
 * A Provider's identity on the platform's own operational screens — never `ConnectorIcon`
 * (`features/integrations/catalogue/connector-icon.tsx`), even though both sit on `BrandMark`:
 * a Provider is infrastructure GOLD operates, a Connector is an outside app a tenant authorizes,
 * and conflating their presentation would blur the same boundary section 1 draws in the schema.
 */
const BRAND_COLOR: Record<string, string> = {
  google: '#4285F4',
  openai: '#10A37F',
  anthropic: '#D97757',
  twilio: '#F22F46',
  resend: '#000000',
};

export function ProviderIcon({ providerKey, label, size = 'default' }: { providerKey: string; label: string; size?: 'small' | 'default' | 'large' }) {
  return <BrandMark label={label} background={BRAND_COLOR[providerKey]} size={size} />;
}
