import { Puzzle } from 'lucide-react';
import { BrandMark } from '@/components/display/brand-mark';
import { GENERATED_MARKS } from '@/features/platform/brand/marks.generated';

/**
 * One child app's identity, inside a suite connector (Google Workspace, Microsoft 365). Real
 * marks are curated by app key alone (`GENERATED_MARKS`, checked-in static SVG data — see
 * `scripts/brand-icons/extract.mjs`): Gmail looks like Gmail regardless of which suite lists it,
 * because it is the same product either way.
 *
 * **Falls back to the parent connector's own identity, then to a generic glyph.** An app this
 * platform has not curated a mark for (Outlook, Excel, Google Docs — see the extraction script's
 * own coverage notes) is still recognizably "part of Microsoft 365" or "part of Google Workspace"
 * rather than an unrelated puzzle piece, which is the honest degrade: showing the suite's own mark
 * for an uncurated app is a real fact (this app belongs to that suite), never a guess at what the
 * app's own logo looks like.
 */
export function ConnectorAppIcon({
  connectorKey,
  appKey,
  label,
  size = 'small',
}: {
  connectorKey?: string;
  appKey: string;
  label: string;
  size?: 'small' | 'default' | 'large';
}) {
  const own = GENERATED_MARKS[appKey];
  if (own) return <BrandMark label={label} mark={own} size={size} />;

  const parent = connectorKey ? GENERATED_MARKS[connectorKey] : undefined;
  if (parent) return <BrandMark label={label} mark={parent} size={size} />;

  return <BrandMark label={label} icon={<Puzzle className="size-4" />} size={size} />;
}
