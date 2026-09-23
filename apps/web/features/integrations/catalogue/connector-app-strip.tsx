import type { ConnectorApp } from '@/lib/domain/integrations/connectors';
import { ConnectorAppIcon } from './connector-app-icons';

/**
 * A suite connector's child apps, as a compact identity strip — never the nineteen-item prose
 * sentence ("Includes Drive, Calendar, Gmail...") the Browse card used to read. Shows a handful of
 * recognizable marks and the count of the rest; not interactive, because nothing here is an
 * action — the strip is *what this connector reaches*, not a control.
 */
export function ConnectorAppStrip({
  apps,
  connectorKey,
  visible = 6,
}: {
  apps: ConnectorApp[];
  connectorKey: string;
  visible?: number;
}) {
  if (apps.length === 0) return null;

  const shown = apps.slice(0, visible);
  const remaining = apps.length - shown.length;

  return (
    <div className="flex items-center gap-1.5">
      {shown.map((app) => (
        <div key={app.id} title={app.name}>
          {/* Each mark carries its own accessible name (BrandMark's role="img" aria-label) — the
              strip itself names nothing, so a screen reader announces each app once, not twice. */}
          <ConnectorAppIcon connectorKey={connectorKey} appKey={app.key} label={app.name} size="small" />
        </div>
      ))}
      {remaining > 0 ? (
        <span className="text-xs text-subtle" aria-label={`and ${remaining} more`}>
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}
