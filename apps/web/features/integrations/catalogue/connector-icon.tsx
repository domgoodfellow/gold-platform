import { FileSpreadsheet } from 'lucide-react';
import { BrandMark } from '@/components/display/brand-mark';
import { GENERATED_MARKS } from '@/features/platform/brand/marks.generated';
import type { Connector } from '@/lib/domain/integrations/connectors';

/**
 * A connector's identity: an uploaded logo wins over everything (`connector.iconRef` /
 * `connectorLogoUrl`, resolved by the caller into `logoUrl`); short of that, a curated real mark
 * (`GENERATED_MARKS`, checked-in static SVG data — see `scripts/brand-icons/extract.mjs`) gives a
 * built-in connector its actual identity before any admin ever uploads one; short of *that*, a
 * curated brand colour with a monogram; an uncatalogued key falls through to `BrandMark`'s own
 * generic tile.
 *
 * **A mark's presence here is also the built-in signal.** `isBuiltInConnector` (below) is what
 * `LogoForm`'s caller checks to decide whether uploading a logo makes sense for a given
 * connector — a built-in identity is platform-owned and is never a business's to override
 * (constraints.md, "Built-in Provider/Connector/App... NO logo-upload UI").
 */
const BRAND_COLOR: Record<string, string> = {
  google_business_profile: '#4285F4',
  microsoft_365: '#D83B01',
  quickbooks: '#2CA01C',
};

/** Every connector key with a curated built-in identity — a mark today, a colour tomorrow. */
export function isBuiltInConnector(connectorKey: string): boolean {
  return connectorKey in GENERATED_MARKS || connectorKey in BRAND_COLOR;
}

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
  const mark = GENERATED_MARKS[connector.key];
  if (mark) return <BrandMark label={connector.name} src={logoUrl} mark={mark} size={size} />;
  return <BrandMark label={connector.name} src={logoUrl} background={BRAND_COLOR[connector.key]} size={size} />;
}
