'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cx, FOCUS_RING } from '../class-names';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';

export type SettingsScope = { key: string; label: string; href: string };

/**
 * One coherent Settings identity: the active scope's name as the page's `<h1>`, the scope tabs
 * directly beneath it as one visual unit — never a title followed by a disconnected explanatory
 * sentence (`docs/ui-spec.md` §2a's Settings/Configuration archetype; the former
 * `SettingsScopeNav` copy line is gone because the active tab already names the scope).
 *
 * `title` is optional for one reason: `PersonalSettingsShell` wraps two distinct pages (Profile,
 * Security & sign-in) that each draw their own `<h1>` beneath this bar. Omitting `title` renders
 * the tabs alone — no second, scope-level heading competing with the page's own — so a shared
 * shell never doubles up the document outline.
 */
export function SettingsHeader({
  title,
  crumbs,
  scopes,
  active,
  meta,
  actions,
}: {
  title?: string;
  crumbs?: PageLocationCrumb[];
  scopes: SettingsScope[];
  active: string;
  /** Short, secondary facts about this scope's record — a connection's status. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {title ? (
        <>
          <PageLocation crumbs={crumbs} current={title} />
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </>
      ) : null}
      {scopes.length > 1 ? (
        <nav aria-label="Settings" className={cx('flex gap-1 overflow-x-auto border-b border-border', title ? 'mt-3' : undefined)}>
          {scopes.map((scope) => (
            <Link
              key={scope.key}
              href={scope.href}
              aria-current={scope.key === active ? 'page' : undefined}
              className={cx(
                FOCUS_RING,
                '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm',
                scope.key === active ? 'border-foreground font-medium' : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {scope.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
