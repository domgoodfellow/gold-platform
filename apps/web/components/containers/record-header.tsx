import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { PageHeading } from './section';

export type RecordCrumb = { label: ReactNode; href?: string };

/** A detail screen's identity and route context. Product metadata remains feature-owned. */
export function RecordHeader({
  title,
  crumbs,
  summary,
  actions,
}: {
  title: ReactNode;
  crumbs: RecordCrumb[];
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => {
            const current = index === crumbs.length - 1;
            return (
              <Fragment key={index}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                {current || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <Link
                    href={crumb.href}
                    className="rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {crumb.label}
                  </Link>
                )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <PageHeading>{title}</PageHeading>
          {summary ? <div className="mt-2 text-sm text-muted">{summary}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
