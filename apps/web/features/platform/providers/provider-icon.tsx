import { BrandMark } from '@/components/display/brand-mark';
import { GENERATED_MARKS } from '@/features/platform/brand/marks.generated';

/**
 * A Provider's identity on the platform's own operational screens — never `ConnectorIcon`
 * (`features/integrations/catalogue/connector-icon.tsx`), even though both sit on `BrandMark`:
 * a Provider is infrastructure GOLD operates, a Connector is an outside app a tenant authorizes,
 * and conflating their presentation would blur the same boundary section 1 draws in the schema.
 *
 * **A real mark when one is curated, a coloured monogram when one is not.** `GENERATED_MARKS` is
 * checked in, static SVG data (`scripts/brand-icons/extract.mjs`) — nothing here fetches a logo at
 * runtime. `BRAND_COLOR` is what a Provider this platform has not curated a mark for still gets:
 * a recognizable colour rather than a bare grey tile, never a broken image.
 */
const BRAND_COLOR: Record<string, string> = {
  google: '#4285F4',
  openai: '#10A37F',
  anthropic: '#D97757',
  twilio: '#F22F46',
  resend: '#000000',
  deepgram: '#13EF93',
  elevenlabs: '#000000',
};

export function ProviderIcon({ providerKey, label, size = 'default' }: { providerKey: string; label: string; size?: 'small' | 'default' | 'large' }) {
  const mark = GENERATED_MARKS[providerKey];
  if (mark) return <BrandMark label={label} mark={mark} size={size} />;
  return <BrandMark label={label} background={BRAND_COLOR[providerKey]} size={size} />;
}
