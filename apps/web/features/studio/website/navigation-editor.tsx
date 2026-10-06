'use client';

import { useState } from 'react';
import type { NavigationItem, WebsiteContent } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle,
} from '@/components/panels/page-drawer';
import { pagePath } from '@/lib/domain/public-site/paths';

/**
 * The website's navigation: which pages appear in the header, in what order, under what label.
 * An item names a page by its id, so renaming a page or changing its path never breaks one; an
 * external link is a separate, explicit kind of item. Changes are part of the draft and reach
 * visitors only when the website is published.
 */
export function NavigationEditor({ open, onOpenChange, content, disabled, onAddPage, onAddExternal, onChange, onMove, onRemove }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: WebsiteContent;
  disabled?: boolean;
  onAddPage: (pageId: string) => void;
  onAddExternal: () => void;
  onChange: (item: NavigationItem) => void;
  onMove: (itemId: string, direction: 'up' | 'down') => void;
  onRemove: (itemId: string) => void;
}) {
  const [pageToAdd, setPageToAdd] = useState('');
  return (
    <PageDrawer open={open} onOpenChange={onOpenChange}>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Navigation</PageDrawerTitle>
          <PageDrawerDescription>The links in the header of every page, in order.</PageDrawerDescription>
        </PageDrawerHeader>
        <fieldset disabled={disabled} className="grid gap-4">
          {content.navigation.length === 0 ? <Hint>No links yet. Visitors will see the pages only if you link to them.</Hint> : null}
          <ol className="grid gap-3">
            {content.navigation.map((item, index) => {
              const page = item.target.type === 'page' ? content.pages.find((entry) => entry.id === (item.target as { pageId: string }).pageId) : null;
              return (
                <li key={item.id} className="grid gap-2 rounded-md border border-border p-3">
                  <FieldLabel className="grid gap-1 text-sm">
                    Label
                    <TextInput value={item.label} maxLength={60} onChange={(event) => onChange({ ...item, label: event.target.value })} />
                  </FieldLabel>
                  {item.target.type === 'page' ? (
                    <FieldLabel className="grid gap-1 text-sm">
                      Page
                      <SelectInput
                        value={item.target.pageId}
                        onChange={(event) => onChange({ ...item, target: { type: 'page', pageId: event.target.value } })}
                      >
                        {content.pages.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.isHome ? 'home' : pagePath(entry)})</option>)}
                      </SelectInput>
                    </FieldLabel>
                  ) : (
                    <FieldLabel className="grid gap-1 text-sm">
                      Address
                      <TextInput
                        type="url" inputMode="url" value={item.target.href}
                        onChange={(event) => onChange({ ...item, target: { type: 'external', href: event.target.value } })}
                      />
                    </FieldLabel>
                  )}
                  <p className="text-xs text-subtle">{page ? `Links to ${page.name}` : item.target.type === 'external' ? 'External link' : 'This page no longer exists'}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" tone="secondary" size="small" disabled={index === 0} aria-label={`Move ${item.label} up`} onClick={() => onMove(item.id, 'up')}>Move up</Button>
                    <Button type="button" tone="secondary" size="small" disabled={index === content.navigation.length - 1} aria-label={`Move ${item.label} down`} onClick={() => onMove(item.id, 'down')}>Move down</Button>
                    <Button type="button" tone="text" size="small" aria-label={`Remove ${item.label} from navigation`} onClick={() => onRemove(item.id)}>Remove</Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-2 border-t border-border pt-4">
            <FieldLabel className="grid gap-1 text-sm">
              Add a page
              <SelectInput value={pageToAdd} onChange={(event) => setPageToAdd(event.target.value)}>
                <option value="">Choose a page…</option>
                {content.pages.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </SelectInput>
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="small" disabled={!pageToAdd} onClick={() => { onAddPage(pageToAdd); setPageToAdd(''); }}>Add page link</Button>
              <Button type="button" tone="secondary" size="small" onClick={onAddExternal}>Add external link</Button>
            </div>
          </div>
        </fieldset>
      </PageDrawerContent>
    </PageDrawer>
  );
}
