import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@gold/ui/components/empty';
import { AppPage } from '../layout/app-page';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';

/**
 * The State/Exception pattern: a 404, an unavailable business, a permission refusal, a paused
 * subscription — never an ordinary page with a `PageHeader`. The recovery action sits inside the
 * same centred column as the message, never pulled to a header's far edge by `justify-between`
 * (`docs/ui-spec.md` §2a, §2e).
 *
 * `title` renders as the page's one `<h1>` — a state screen is still a navigable page and still
 * needs a meaningful heading, even though it looks nothing like `PageHeader`. `location` is
 * optional because some states (an unresolved organization) cannot safely publish one.
 */
export function StatePage({
  title,
  description,
  media,
  action,
  secondaryAction,
  notes,
  location,
}: {
  title: string;
  description: string;
  media?: ReactNode;
  action: ReactNode;
  secondaryAction?: ReactNode;
  /** Supplementary explanation beneath the actions — a billing recovery note, a permission detail. */
  notes?: ReactNode;
  location?: { crumbs?: PageLocationCrumb[]; current: ReactNode };
}) {
  return (
    <AppPage width="form">
      {location ? <PageLocation crumbs={location.crumbs} current={location.current} /> : null}
      <Empty className="border-none px-0 py-16">
        <EmptyHeader>
          {media ? <EmptyMedia>{media}</EmptyMedia> : null}
          <h1 className="font-heading text-base font-medium">{title}</h1>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-3">
            {action}
            {secondaryAction}
          </div>
          {notes ? <div className="flex flex-col gap-1 text-center">{notes}</div> : null}
        </EmptyContent>
      </Empty>
    </AppPage>
  );
}
