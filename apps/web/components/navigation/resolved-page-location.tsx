'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@gold/ui/components/breadcrumb';
import { pageNavigation, type PageNavigation } from '@/lib/shell';
import { cx, FOCUS_RING } from '../class-names';
import { MobilePageLocation, useLocationNavigation, useResolvedLocation } from './workspace-crumbs';

/**
 * The workspace bar's location on a route `resolveLocation` owns (ADR-047): one resolved answer
 * drives the desktop trail, the phone's Up control and the current page. Rendered by
 * `WorkspaceCrumbSlot` itself rather than portalled in by the page, so it stays in place while the
 * page loads. Labels arrive already resolved by key; nothing here matches displayed words.
 */
export function ResolvedPageLocation() {
  const projection = useLocationNavigation();
  const location = useResolvedLocation();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  if (!location) return null;
  // An unsupplied record label already falls back to the record's kind; only a level with no label at all is left out.
  const current = location.current.label || null;
  const crumbs = location.trail.filter((crumb) => crumb.label);
  // The sibling menu still comes from the authorized projection; the parent is the resolver's.
  const menu = pageNavigation(projection, pathname, crumbs.map((crumb) => crumb.href));
  const navigation: PageNavigation = { ...menu, parentHref: location.up };
  return (
    <>
      <MobilePageLocation key={`${pathname}:${isMobile}`} current={current ?? ''} navigation={navigation} />
      <Breadcrumb className="hidden md:block">
        <BreadcrumbList className="flex-nowrap gap-1 text-sm">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              <BreadcrumbItem className="min-w-0 shrink">
                {crumb.href ? (
                  <Link href={crumb.href} className={cx('block truncate rounded underline-offset-4 hover:text-foreground hover:underline', FOCUS_RING)}>{crumb.label}</Link>
                ) : (
                  <span className="block truncate">{crumb.label}</span>
                )}
              </BreadcrumbItem>
              {index < crumbs.length - 1 || current !== null ? <BreadcrumbSeparator /> : null}
            </Fragment>
          ))}
          {current !== null ? (
            <BreadcrumbItem className="min-w-0 flex-1">
              <BreadcrumbPage className="block truncate" title={current}>{current}</BreadcrumbPage>
            </BreadcrumbItem>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
