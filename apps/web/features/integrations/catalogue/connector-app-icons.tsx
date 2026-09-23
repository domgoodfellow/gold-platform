import { Puzzle } from 'lucide-react';
import { BrandMark } from '@/components/display/brand-mark';
import { GENERATED_APP_MARKS, GENERATED_MARKS } from '@/features/platform/brand/marks.generated';

/**
 * One child app's identity, inside a suite connector (Google Workspace, Microsoft 365).
 *
 * **Resolved by `connectorKey` + `appKey` together, never by `appKey` alone.** Two suites seed the
 * same app key for two different real apps — both a `google_workspace` and a `microsoft_365`
 * connector have a `calendar` app, and they are not the same product. `GENERATED_APP_MARKS` is
 * keyed `${connectorKey}:${appKey}` for exactly that reason (checked-in static SVG data — see
 * `scripts/brand-icons/extract.mjs`); looking up `appKey` on its own would hand one suite's
 * identity to the other's app the moment two suites share a key, which they already do.
 *
 * **Falls back to the parent connector's own identity, then to a generic glyph.** An app this
 * platform has not curated a mark for (Outlook, Excel — see the extraction script's own coverage
 * notes) is still recognizably "part of Microsoft 365" or "part of Google Workspace" rather than an
 * unrelated puzzle piece, which is the honest degrade: showing the suite's own mark for an
 * uncurated app is a real fact (this app belongs to that suite), never a guess at what the app's
 * own logo looks like.
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
  const own = connectorKey ? GENERATED_APP_MARKS[`${connectorKey}:${appKey}`] : undefined;
  if (own) return <BrandMark label={label} mark={own} size={size} />;

  const parent = connectorKey ? GENERATED_MARKS[connectorKey] : undefined;
  if (parent) return <BrandMark label={label} mark={parent} size={size} />;

  return <BrandMark label={label} icon={<Puzzle className="size-4" />} size={size} />;
}
