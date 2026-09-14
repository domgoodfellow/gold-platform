'use client';

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { cx } from '../class-names';

/**
 * A page's own identity, registered for the shell header to render — the fix for two separate
 * duplication patterns: business detail routes rendering `RecordHeader` as page-body content
 * (breadcrumb + `<h1>` + actions, a second identity below the shell's own), and every Platform
 * page rendering its own `PageHeading`/`RecordHeader` beside a header that already tried to guess
 * a title from the pathname (`platform-header-title.tsx`'s module-scoped store, one caller, one
 * page at a time). The header becomes authoritative; the body starts with content.
 *
 * Presentation metadata only — no domain logic belongs here, matching `RecordHeader`'s prior prop
 * shape so migrating a caller is a mechanical move, not a rewrite.
 */
export type PageChromeCrumb = { label: ReactNode; href?: string };

export type PageChrome = {
  /** The current page — rendered as the final, unlinked breadcrumb segment. */
  title: ReactNode;
  /** Ancestors only; the current page is `title`, not the last entry here. */
  crumbs?: PageChromeCrumb[];
  /** Short, secondary context beside the identity — a schedule window, a currency note. */
  status?: ReactNode;
  /** Page-level actions. Render before the mobile account control, Configure and Agent. */
  actions?: ReactNode;
};

type PageChromeContextValue = {
  chrome: PageChrome | null;
  registerChrome: (chrome: PageChrome | null) => void;
};

const PageChromeContext = createContext<PageChromeContextValue | null>(null);

/** `WorkspaceShell` owns this provider's lifetime, alongside `WorkspaceRailProvider`. */
export function WorkspacePageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PageChrome | null>(null);
  const registerChrome = useCallback((next: PageChrome | null) => setChrome(next), []);
  const value = useMemo(() => ({ chrome, registerChrome }), [chrome, registerChrome]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

function usePageChromeContext() {
  const context = useContext(PageChromeContext);
  if (!context) throw new Error('usePageChromeContext must be used within WorkspacePageChromeProvider');
  return context;
}

/**
 * A page registers its own identity on mount, un-registers on unmount — the same lifecycle
 * `useConfigurePanel` already proves, so navigating away from a page that set chrome leaves the
 * header showing whatever shell-owned default (`AreaTrail`, a static fallback) sits behind it.
 *
 * **Callers must pass a `chrome` that is referentially stable across re-renders carrying no new
 * data** (`useMemo`d — see `PageChromeRegistrar`), for the same reason `useConfigurePanel`
 * documents: an unmemoized object literal re-runs the effect, and the provider's `setState`, on
 * every render this component takes part in.
 */
export function useWorkspacePageChrome(chrome: PageChrome | null) {
  const { registerChrome } = usePageChromeContext();
  useEffect(() => {
    registerChrome(chrome);
    return () => registerChrome(null);
  }, [chrome, registerChrome]);
}

/** Consumed by `WorkspaceHeader` to render a registered page's identity in place of its default. */
export function usePageChrome(): PageChrome | null {
  return usePageChromeContext().chrome;
}

/**
 * Registers a page's chrome and renders nothing itself — `WorkspaceHeader` decides where and how
 * the identity actually appears. `RecordHeader` is this registrar under its historical name and
 * prop shape, kept so call sites needed no prop changes to stop rendering a second heading.
 */
export function PageChromeRegistrar({ title, crumbs, status, actions }: PageChrome) {
  const chrome = useMemo(
    () => ({ title, crumbs, status, actions }),
    [title, crumbs, status, actions],
  );
  useWorkspacePageChrome(chrome);
  return null;
}

/** The header's rendering of registered chrome — one line: ancestors, then the current page, bold. */
export function PageChromeIdentity({ chrome }: { chrome: PageChrome }) {
  const segments: PageChromeCrumb[] = [...(chrome.crumbs ?? []), { label: chrome.title }];

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap gap-1 overflow-hidden text-sm">
        {segments.map((segment, index) => {
          const current = index === segments.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className={cx(current ? 'min-w-0' : 'shrink-0')}>
                {current ? (
                  <BreadcrumbPage className="truncate">{segment.label}</BreadcrumbPage>
                ) : segment.href ? (
                  <Link
                    href={segment.href}
                    className="truncate rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {segment.label}
                  </Link>
                ) : (
                  // An ancestor label with no route of its own — a group name, not a page.
                  <span className="truncate">{segment.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
