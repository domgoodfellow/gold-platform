import { FileSpreadsheet } from 'lucide-react';
import { BrandMark } from '@/components/display/brand-mark';
import { GENERATED_MARKS } from '@/features/platform/brand/marks.generated';
import type { Connector } from '@/lib/domain/integrations/connectors';

/**
 * A connector's identity. **For a built-in connector, the canonical mark is authoritative over
 * any stored `iconRef`** — a business cannot upload a replacement for it (the UI already refuses
 * to offer that; this is rendering keeping the same promise). Only a connector this platform has
 * *not* curated an identity for reads `logoUrl` at all, and only then does an uploaded logo win
 * over the generic tile.
 *
 * `GENERATED_MARKS` is checked-in static SVG data (`scripts/brand-icons/extract.mjs`); `BRAND_COLOR`
 * is the fallback for a built-in connector this platform has not extracted a real mark for yet.
 * Neither ever reads `connector.iconRef` — an old value stored there for a connector that has
 * since become built-in is simply ignored, never deleted (a business's own upload history for a
 * connector that later goes built-in is not this component's to erase).
 *
 * **A mark or a curated colour's presence here is also the built-in signal.**
 * `isBuiltInConnector` (below) is what `LogoForm`'s caller checks to decide whether uploading a
 * logo makes sense for a given connector (constraints.md, "Built-in Provider/Connector/App...
 * NO logo-upload UI") — and now also what this component checks to decide whether `logoUrl` is
 * even looked at.
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
  if (mark) return <BrandMark label={connector.name} mark={mark} size={size} />;
  if (connector.key in BRAND_COLOR) return <BrandMark label={connector.name} background={BRAND_COLOR[connector.key]} size={size} />;
  // Not a curated built-in identity at all — the one case an uploaded logo is ever consulted.
  return <BrandMark label={connector.name} src={logoUrl} size={size} />;
}
