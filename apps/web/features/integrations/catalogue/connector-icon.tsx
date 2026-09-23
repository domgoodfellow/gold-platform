import { FileSpreadsheet } from 'lucide-react';
import { BrandMark } from '@/components/display/brand-mark';
import type { Connector } from '@/lib/domain/integrations/connectors';

/**
 * A connector's identity: an uploaded logo wins over everything (`connector.iconRef` /
 * `connectorLogoUrl`, resolved by the caller into `logoUrl`); short of that, a curated brand
 * colour with a monogram gives a seeded connector a recognizable mark before any admin ever
 * uploads one; an uncatalogued key falls through to `BrandMark`'s own generic tile.
 *
 * **No hand-encoded vendor logo paths.** Reaching for the exact multi-colour Google "G" or the
 * Slack pinwheel would mean carrying trademarked artwork this codebase does not license, for a
 * screen that only needs *recognizable*, not pixel-exact — a coloured monogram in the real brand
 * colour is the smallest maintainable option that still tells two connectors apart at a glance.
 */
const BRAND_COLOR: Record<string, string> = {
  google_workspace: '#4285F4',
  google_business_profile: '#4285F4',
  google_ads: '#4285F4',
  google_analytics: '#4285F4',
  google_search_console: '#4285F4',
  youtube: '#FF0000',
  microsoft_365: '#D83B01',
  notion: '#000000',
  slack: '#4A154B',
  dropbox: '#0061FF',
  hubspot: '#FF7A59',
  salesforce: '#00A1E0',
  quickbooks: '#2CA01C',
  shopify: '#95BF47',
};

export function ConnectorIcon({
  connector,
  logoUrl,
  size = 'default',
}: {
  connector: Pick<Connector, 'key' | 'name'>;
  /** Resolved by the caller from `connector.iconRef` via `connectorLogoUrl` — never fetched here. */
  logoUrl: string | null;
  size?: 'small' | 'default' | 'large';
}) {
  if (connector.key === 'csv') {
    return <BrandMark label={connector.name} src={logoUrl} background="#6b7280" icon={<FileSpreadsheet className="size-4" />} size={size} />;
  }
  return <BrandMark label={connector.name} src={logoUrl} background={BRAND_COLOR[connector.key]} size={size} />;
}
