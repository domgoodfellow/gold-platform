'use client';
import { BusinessLabel, useBusinessProfile } from '@/lib/context/business-vocabulary';

import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@gold/ui/components/dropdown-menu';
import { Button, ButtonLink } from '../controls/button';
import { pageNavigation, projectedItems, type LocationNavigation, type PageNavigation } from '@/lib/shell';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { cx, FOCUS_RING } from '../class-names';
import { adoptsResolvedLocation, locationAccessFrom, resolveLocation, type LocationAccess, type RecordLabel, type ResolvedLocation } from '@/lib/route/page-location';
// A deliberate two-way import: the slot hosts the resolver-owned renderer, which reads this file's context.
import { ResolvedPageLocation } from './resolved-page-location';

export type Crumb = { label: ReactNode; href?: string };

/**
 * What a page hands up about its own address, and nothing about any other: server-loaded record
 * labels, or that the page refused (`notFound`).
 */
type PageReport = { pathname: string; records: Readonly<Record<string, RecordLabel>>; notFound?: boolean };

type SlotContext = {
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
  navigation?: LocationNavigation;
  /** The one resolved location for this address, or null where the page still publishes its own. */
  location: ResolvedLocation | null;
  setReport: Dispatch<SetStateAction<PageReport | null>>;
};

const CrumbSlotContext = createContext<SlotContext | null>(null);

/**
 * Without the shell's access facts, a gated ancestor is never offered as a link: only the kernel
 * destinations every member has (Home, a workspace Home, Customers) still link. A link is never assumed.
 */
const NO_ACCESS: LocationAccess = { gate: { enabledModules: new Set(), featureAvailability: new Set(), capabilities: new Set() }, platform: new Set() };

/**
 * Hosts the workspace bar's location. Two systems coexist while pages migrate (ADR-047): on a route
 * `adoptsResolvedLocation` names, the location is resolved **once, here**, and the bar, the phone's
 * Up control and the page's `h1` all read that one answer; the page only hands up its record labels.
 * On every other route the page still publishes its own crumbs into the slot. A route is in exactly
 * one of the two.
 */
export function WorkspaceCrumbsProvider({ children, navigation }: { children: ReactNode; navigation?: LocationNavigation }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [report, setReport] = useState<PageReport | null>(null);
  const pathname = usePathname();
  const vocabulary = useBusinessProfile();
  // A report about another address — the page just left — is never read.
  const current = report?.pathname === pathname ? report : null;
  const location = useMemo(() => {
    if (!adoptsResolvedLocation(pathname)) return null;
    const resolved = resolveLocation({
      pathname,
      access: navigation?.access ? locationAccessFrom(navigation.access) : NO_ACCESS,
      vocabulary,
      records: current?.records,
      ...(current?.notFound ? { state: 'not-found' as const } : {}),
      navigation: navigation?.sections,
    });
    return resolved.status === 'resolved' ? resolved : null;
  }, [pathname, navigation, vocabulary, current]);
  useIncompleteLocationDiagnostic(location);
  return <CrumbSlotContext.Provider value={{ slot, setSlot, navigation, location, setReport }}>{children}</CrumbSlotContext.Provider>;
}

/**
 * Development only: a migrated record route whose page never handed up its label. Reported once
 * the page has had its chance to report, so the moment before a page's first report is not noise.
 */
function useIncompleteLocationDiagnostic(location: ResolvedLocation | null) {
  const incomplete = location?.incomplete.join(',') ?? '';
  const id = location?.id;
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !incomplete) return;
    const timer = setTimeout(() => console.warn(`Page location "${id}" is incomplete: no label was supplied for ${incomplete}. The bar shows the record's kind instead.`), 1000);
    return () => clearTimeout(timer);
  }, [id, incomplete]);
}

/** The current page's one resolved location, or null on a route that still publishes its own. */
export function useResolvedLocation(): ResolvedLocation | null {
  return useContext(CrumbSlotContext)?.location ?? null;
}

/**
 * Hands this page's server-loaded record labels to the bar, for its own address only. A loading
 * boundary hands up `{ state: 'loading' }`, a not-found boundary `{ state: 'missing' }` or
 * `notFound`; a label is only ever the record the page itself was allowed to read.
 */
export function PageLocationRecords({ records = {}, notFound = false }: { records?: Readonly<Record<string, RecordLabel>>; notFound?: boolean }) {
  const setReport = useContext(CrumbSlotContext)?.setReport;
  const pathname = usePathname();
  const handed = useRef<PageReport | null>(null);
  const key = JSON.stringify(records);
  useLayoutEffect(() => {
    if (!setReport) return;
    const mine: PageReport = { pathname, records: JSON.parse(key) as PageReport['records'], ...(notFound ? { notFound } : {}) };
    handed.current = mine;
    setReport(mine);
    // Only withdraw what this component handed up, so a page arriving in the same commit keeps its own.
    return () => setReport((current) => (current === handed.current ? null : current));
  }, [setReport, pathname, key, notFound]);
  return null;
}

/**
 * The page's one `h1`, named by the same resolved location the bar shows; the bar already shows it,
 * so it is visually hidden. Renders nothing on a route that still publishes its own identity.
 */
export function LocationHeading({ required = false }: { required?: boolean }) {
  const location = useResolvedLocation();
  const pathname = usePathname();
  useEffect(() => {
    // A header that asked for the resolver's location on a route not yet migrated would have no heading and no location.
    if (required && !location && process.env.NODE_ENV !== 'production') console.warn(`A header uses the resolved page location on "${pathname}", which is not in RESOLVED_LOCATION_ROUTES.`);
  }, [required, location, pathname]);
  return location ? <h1 className="sr-only">{location.headingName}</h1> : null;
}


/** The place in the workspace bar where the current page's trail appears. */
/** The authorized navigation projection this shell was given, for a page control that presents part of it. */
export function useLocationNavigation(): LocationNavigation | undefined {
  return useContext(CrumbSlotContext)?.navigation;
}

export function WorkspaceCrumbSlot() {
  const context = useContext(CrumbSlotContext);
  const pathname = usePathname();
  // A resolver-owned route draws its location here directly, so it stays in place while the page loads.
  return <div ref={context?.setSlot} className="min-w-0 flex-1 md:flex-initial">{adoptsResolvedLocation(pathname) ? <ResolvedPageLocation /> : null}</div>;
}

export function MobilePageLocation({ current, navigation }: { current: ReactNode; navigation: PageNavigation }) {
  const [open, setOpen] = useState(false);
  const interactive = navigation.groups.reduce((count, group) => count + group.items.length + (group.href ? 1 : 0), 0) > 1;
  return <nav aria-label="Page location" className="flex min-w-0 items-center gap-1 md:hidden">
    {navigation.parentHref ? <ButtonLink href={navigation.parentHref} tone="ghost" aria-label="Back to parent" className="size-10 shrink-0 p-0"><ArrowLeft aria-hidden size={18} /></ButtonLink> : null}
    {interactive ? <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button tone="ghost" className="h-10 min-w-0 shrink justify-start gap-1 px-2" aria-label="Navigate within current section">
          <span aria-current="page" className="truncate">{current}</span><ChevronDown aria-hidden size={16} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70dvh,28rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
        {navigation.groups.map((group, index) => <Fragment key={index}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label && group.href ? (
            // A workspace's heading is its Home (ADR-047), so here it is a destination, not a caption.
            <DropdownMenuItem asChild>
              <Link href={group.href} aria-label={`${group.label} home`} aria-current={group.current ? 'page' : undefined} className={cx('min-h-10 min-w-0 font-semibold', group.current && 'bg-selected text-foreground')}>
                <span className="min-w-0 flex-1 whitespace-normal break-words">{group.label}</span>
                {group.current ? <Check aria-hidden size={16} /> : null}
              </Link>
            </DropdownMenuItem>
          ) : group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href} aria-current={item.key === navigation.activeKey ? 'page' : undefined} className={cx('min-h-10 min-w-0', item.key === navigation.activeKey && 'bg-selected text-foreground font-medium')}>
              <span className="min-w-0 flex-1 whitespace-normal break-words">{item.label}</span>
              {item.key === navigation.activeKey ? <Check aria-hidden size={16} /> : null}
            </Link>
          </DropdownMenuItem>)}
        </Fragment>)}
      </DropdownMenuContent>
    </DropdownMenu> : <span aria-current="page" className="min-w-0 truncate px-2 text-sm">{current}</span>}
  </nav>;
}

/** Desktop and mobile share the page's published current label and ancestors. */
export function PageCrumbs({ crumbs: authoredCrumbs, current }: { crumbs: Crumb[]; current: ReactNode }) {
  const context = useContext(CrumbSlotContext);
  const slot = context?.slot;
  const destinations = projectedItems(context?.navigation?.sections ?? []);
  const crumbs = authoredCrumbs.map(crumb => { const destination = destinations.find(item => item.href === crumb.href); return destination ? {...crumb,label:destination.label} : crumb; });
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const navigation = pageNavigation(context?.navigation, pathname, crumbs.map((crumb) => crumb.href));
  // On a resolver-owned route the bar already shows the location; a page-authored trail never competes with it.
  if (!slot || adoptsResolvedLocation(pathname)) return null;
  return createPortal(
    <>
    <MobilePageLocation key={`${pathname}:${isMobile}`} current={current} navigation={navigation} />
    <Breadcrumb className="hidden md:block">
      <BreadcrumbList className="flex-nowrap gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            <BreadcrumbItem className="min-w-0 shrink">
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className={cx('block truncate rounded underline-offset-4 hover:text-foreground hover:underline', FOCUS_RING)}
                >
                  <BusinessLabel>{crumb.label}</BusinessLabel>
                </Link>
              ) : (
                <span className="block truncate"><BusinessLabel>{crumb.label}</BusinessLabel></span>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem className="min-w-0 flex-1">
          <BreadcrumbPage className="block truncate">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    </>,
    slot,
  );
}
