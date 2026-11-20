'use client';

import { useMemo, useState, useTransition, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { setNavigationLayoutAction } from '@/app/organizations/[organizationId]/studio/interface/navigation/actions';
import { Button } from '@/components/controls/button';
import { SelectField, type SelectOption } from '@/components/controls/select-field';
import { Badge } from '@/components/display/data';
import { PreviewFrame } from '@/components/display/preview-frame';
import { useLocationNavigation } from '@/components/navigation/workspace-crumbs';
import type { NavigationLayout } from '@/lib/interface-design';
import type { NavItem, ShellSection } from '@/lib/shell';

/**
 * Studio → Interface design → Navigation (ADR-056): GildOps' own shell composition, previewed from
 * the authorized projection this person's shell already holds. Nothing here is a second list of
 * links: every row is drawn by the real sidebar renderer from the same sections the sidebar draws.
 *
 * The boundaries are kept for later iterations: a `NavigationProposal` is what a draft
 * configuration will grow into (today only the layout), `NavigationPreview` draws any proposal at
 * any address and width, and applying is a separate server action that re-checks authority.
 * Publishing a navigation for everybody and editing routes are deliberately absent.
 */
export type NavigationProposal = { layout: NavigationLayout };
export type PreviewViewport = 'desktop' | 'rail' | 'phone';

/** The shell's own sidebar renderer (`OrgNav`), supplied by the route so this feature owns no shell component. */
export type SidebarRenderer = ComponentType<{ sections: ShellSection[]; organizationId: string; layout: NavigationLayout; pathname: string; label: string }>;

const LAYOUT_LABELS: Record<NavigationLayout, string> = { contextual: 'Current', unified: 'Unified' };
const PHONE_WIDTH = 390;

/** One proposal, drawn at a simulated address. Following a link moves the simulated address instead of leaving the page. */
export function NavigationPreview({ Navigation, sections, organizationId, proposal, location, viewport, onNavigate }: {
  Navigation: SidebarRenderer;
  sections: ShellSection[];
  organizationId: string;
  proposal: NavigationProposal;
  location: string;
  viewport: PreviewViewport;
  onNavigate: (href: string) => void;
}) {
  const label = `${LAYOUT_LABELS[proposal.layout]} navigation preview`;
  const follow = (event: MouseEvent) => {
    const link = (event.target as Element).closest('a[href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(link.getAttribute('href')!);
  };
  const nav = <Navigation sections={sections} organizationId={organizationId} layout={proposal.layout} pathname={location} label={label} />;

  if (viewport === 'phone') {
    // An isolated viewport, so the sidebar's own phone breakpoints apply as they do in the Menu sheet.
    return (
      <div className="w-full" style={{ maxWidth: PHONE_WIDTH }}>
        <PreviewFrame title={label} width={PHONE_WIDTH} interactive>
          <div onClickCapture={follow} className="flex min-h-160 flex-col bg-sidebar text-sidebar-foreground">{nav}</div>
        </PreviewFrame>
      </div>
    );
  }
  const rail = viewport === 'rail';
  return (
    // `group` with the sidebar's own collapsed attributes draws the icon rail exactly as `Sidebar` does.
    <div
      onClickCapture={follow}
      className={rail ? 'group w-12 shrink-0 border border-sidebar-border bg-sidebar text-sidebar-foreground' : 'group w-64 shrink-0 border border-sidebar-border bg-sidebar text-sidebar-foreground'}
      data-collapsible={rail ? 'icon' : ''}
      data-state={rail ? 'collapsed' : 'expanded'}
    >
      {nav}
    </div>
  );
}

/** Every address the projection can send this person to, named by where it sits. */
function previewLocations(sections: readonly ShellSection[]): SelectOption[] {
  const options: SelectOption[] = [];
  const seen = new Set<string>();
  const walk = (item: NavItem, parent?: string) => {
    const href = item.href.split(/[?#]/)[0];
    if (!item.group && !seen.has(href)) {
      seen.add(href);
      options.push({ value: href, label: parent && parent !== item.label ? `${parent} · ${item.label}` : item.label });
    }
    const owner = item.key.startsWith('workspace-') || item.key === 'administration' ? item.label : parent;
    for (const child of [...(item.children ?? []), ...(item.destinations ?? []), ...(item.configuration ? [item.configuration] : []), ...(item.administration ? [item.administration] : []), ...(item.design ? [item.design] : [])]) walk(child, owner);
  };
  for (const section of sections) for (const item of section.items) walk(item);
  return options;
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void }) {
  return (
    <div role="group" aria-label={label} data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
      {options.map((option) => (
        <button key={option.value} type="button" data-slot="tabs-trigger" aria-pressed={option.value === value} onClick={() => onChange(option.value)} className={tabTriggerStyles}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Applies a layout to this person's own browser, or returns to the default. */
export function ApplyNavigationLayout({ organizationId, applied }: { organizationId: string; applied: NavigationLayout }) {
  const [pending, start] = useTransition();
  const next: NavigationLayout = applied === 'unified' ? 'contextual' : 'unified';
  return (
    <Button
      type="button"
      tone={applied === 'unified' ? 'secondary' : 'primary'}
      disabled={pending}
      onClick={() => start(async () => {
        const result = await setNavigationLayoutAction(organizationId, next);
        if (!result.ok) toast.error(result.error);
        else toast.success(result.layout === 'unified' ? 'Unified navigation applied to your session' : 'Current navigation restored');
      })}
    >
      {applied === 'unified' ? 'Return to current navigation' : 'Use unified navigation'}
    </Button>
  );
}

export function NavigationExperiment({ Navigation, organizationId, applied }: { Navigation: SidebarRenderer; organizationId: string; applied: NavigationLayout }) {
  const navigation = useLocationNavigation();
  const sections = useMemo(() => [...(navigation?.sections ?? [])], [navigation]);
  const pathname = usePathname();
  const [location, setLocation] = useState(pathname);
  const [compare, setCompare] = useState<'both' | NavigationLayout>('both');
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const locations = useMemo(() => previewLocations(sections), [sections]);
  const shown: NavigationLayout[] = compare === 'both' ? ['contextual', 'unified'] : [compare];

  const preview = (layout: NavigationLayout): ReactNode => (
    <section key={layout} aria-labelledby={`navigation-preview-${layout}`} className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <h2 id={`navigation-preview-${layout}`} className="text-sm font-semibold">{LAYOUT_LABELS[layout]}</h2>
        {applied === layout ? <Badge>In use</Badge> : null}
      </div>
      <NavigationPreview Navigation={Navigation} sections={sections} organizationId={organizationId} proposal={{ layout }} location={location} viewport={viewport} onNavigate={setLocation} />
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Choice label="Layouts" value={compare} onChange={setCompare} options={[{ value: 'both', label: 'Compare' }, { value: 'contextual', label: 'Current' }, { value: 'unified', label: 'Unified' }]} />
        <Choice label="Width" value={viewport} onChange={setViewport} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'rail', label: 'Rail' }, { value: 'phone', label: 'Phone' }]} />
        <SelectField aria-label="Address" className="w-full sm:w-80" options={locations.some((option) => option.value === location) ? locations : [{ value: location, label: location }, ...locations]} value={location} onValueChange={setLocation} />
      </div>
      <div className="flex flex-wrap items-start gap-6">{shown.map(preview)}</div>
    </div>
  );
}
