import { ViewNav, type ViewNavItem } from './view-nav';

/**
 * A record's destinations in two levels: a short row of top-level sections, and — inside the
 * current one — its own sub-sections. Every destination is a URL, so a section is linkable,
 * survives reload and works without script. Callers pass only destinations the viewer may open
 * and whose underlying capability applies; this never decides visibility.
 */
export function RecordSubnavigation({ label, sections, current, subsections, currentSubsection }: {
  label: string; sections: readonly ViewNavItem[]; current: string;
  subsections?: readonly ViewNavItem[]; currentSubsection?: string;
}) {
  return <div data-slot="record-subnavigation" className="mb-4 flex flex-col gap-2">
    <ViewNav label={label} items={sections} current={current} variant="line" scroll={false} className="mb-0 w-full" />
    {subsections && subsections.length > 1 ? <ViewNav label={`${label}: sections`} items={subsections} current={currentSubsection} size="small" scroll={false} className="mb-0" /> : null}
  </div>;
}
