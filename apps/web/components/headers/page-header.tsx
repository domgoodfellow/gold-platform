import type { ReactNode } from 'react';
import { cx } from '../class-names';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';
import { SupportTrigger } from '../panels/workspace-right-rail';

export type PageHeaderCrumb = PageLocationCrumb;

/**
 * One available page-identity composition — title, optional metadata, actions and support modes —
 * built on `PageLocation` (`docs/ui-spec.md` §2a). It is not the required representation of every
 * page: a screen pattern under `components/patterns/` may publish `PageLocation` directly and draw
 * its own identity where this generic title-row shape does not fit the task.
 *
 * It sits inside the page's own `AppPage`, so it shares the canvas its content sits on and is
 * never full-bleed; `WorkspaceHeader` above it is the global bar and holds none of this.
 *
 * A Server Component on purpose — a page passes whatever interactive actions it wants
 * (`CreateResourceTrigger`) as children of `actions`, and only those are client code.
 * Presentation only: no route, no capability, no domain knowledge. A page decides which actions
 * to offer; hiding one is courtesy, never the security boundary.
 *
 * **The page-support modes are always last, in one order: Activity, Insights, Configure.** They open
 * the right-hand rail, so they sit nearest that edge, after every business action. A page asks for
 * a mode with `activity`, `insights` or `configure` — only a mode it genuinely supports — and never
 * places one, which is what makes the order impossible to get wrong; `SupportTrigger` is rendered
 * nowhere else. Each is paired with a `SupportRegistrar` on the page that holds its content.
 *
 * `crumbs` are ancestors only; `title` is the current page and the page's single `<h1>`. This
 * always publishes a trail into the workspace bar — `ancestors + current page` — even when
 * `crumbs` is empty, so no page leaves the sticky header's location area blank. The published
 * current-page label is `breadcrumbLabel` when given, else `title` itself; the override exists
 * only for a title that is visually richer (an icon, a status pill) than the plain text a
 * breadcrumb should show.
 *
 * **There is no generic `description` prop.** A sentence restating what a screen is for, placed
 * under every title whether or not it earned the space, is exactly the sameness Phase B retires —
 * see `docs/ui-spec.md` §2a and §2d. Explanatory text belongs beside the content it explains, in a
 * workspace-home's own structure, or nowhere; `meta` remains for short factual metadata (a
 * schedule window, a status), never a restated purpose sentence.
 */
export function PageHeader({
  title,
  crumbs,
  section,
  breadcrumbLabel,
  meta,
  actions,
  activity = false,
  insights = false,
  configure = false,
  className,
}: {
  title: ReactNode;
  crumbs?: PageHeaderCrumb[];
  /**
   * For a page that belongs to a section the global bar can name once — Settings, Help — and whose
   * title is the page itself. The bar shows the section; the title beneath is the single visible
   * statement of the page, so the same words are not printed twice. Replaces `crumbs` and
   * `breadcrumbLabel`; the `<h1>` is unchanged.
   */
  section?: string;
  /** Overrides the current-page breadcrumb label; defaults to `title`. */
  breadcrumbLabel?: ReactNode;
  /** Short, secondary facts about the record — a schedule window, a status — under the title. */
  meta?: ReactNode;
  /** Business actions, in reading order. Never Configure — see `configure`. */
  actions?: ReactNode;
  /** Offers the Activity mode: what recently changed here. Only where a domain-level read exists. */
  activity?: boolean;
  /** Offers the Insights mode: a few numbers for this workspace, from the reporting aggregates. */
  insights?: boolean;
  /** Offers Configure. Courtesy only; the panel's own writes are guarded by RLS. */
  configure?: boolean;
  /** Replaces the default bottom margin (`mb-6`) where the parent already spaces its children. */
  className?: string;
}) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className ?? 'mb-6')}>
      <div className="min-w-0 flex-1 basis-64">
        <PageLocation crumbs={section ? [] : crumbs} current={section ?? breadcrumbLabel ?? title} />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      </div>
      {actions || activity || insights || configure ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {activity ? <SupportTrigger mode="activity" /> : null}
          {insights ? <SupportTrigger mode="insights" /> : null}
          {configure ? <SupportTrigger mode="configure" /> : null}
        </div>
      ) : null}
    </header>
  );
}
