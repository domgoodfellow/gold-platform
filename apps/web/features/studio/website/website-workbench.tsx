'use client';

import { useActionState, useEffect, useState } from 'react';
import type { PageTemplate, SectionPattern, SiteTemplate, WebsiteContent, WebsiteSection } from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  addNavigationExternal, addNavigationPage, addPage, addSection, blankPage, duplicatePage, duplicateSection,
  moveNavigationItem, moveSection, pageFromTemplate, removeNavigationItem, removePage, removeSection,
  setHomepage, updateNavigationItem, updatePage, updateSection,
} from '@/lib/domain/public-site/composition';
import type { EditorRevision, RevisionHistoryEntry } from '@/lib/domain/public-site/public-site';
import {
  publishRevisionAction,
  saveDraftAction,
  submitRevisionAction,
  createDraftAction,
  type WebsiteActionState,
} from '@/app/organizations/[organizationId]/studio/website/actions';
import { SiteStructure } from './site-structure';
import { WebsiteCanvas, VIEWPORT_LABEL, type Viewport } from './website-canvas';
import { PageInspector } from './page-inspector';
import { SectionEditor } from './section-editors';
import { SectionLibrary } from './section-library';
import { NavigationEditor } from './navigation-editor';
import { CreateWebsite } from './create-website';
import { WebsiteHistorySheet } from './website-history-sheet';
import type { FormOption, Selection } from './types';

const INITIAL: WebsiteActionState = { error: null };

function Feedback({ state }: { state: WebsiteActionState }) {
  if (state.error) return <ErrorText>{state.error}</ErrorText>;
  if (state.success) return <Hint role="status">{state.success}</Hint>;
  return null;
}

/** No working revision: the website is published and nothing is being changed, or was just restored from. */
function NoDraftState({ organizationId, published, history }: { organizationId: string; published: EditorRevision | null; history: RevisionHistoryEntry[] }) {
  const [createState, createAction, creating] = useActionState(createDraftAction, INITIAL);
  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <WebsiteHistorySheet organizationId={organizationId} history={history} canRestore />
        {published ? <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${published.id}`} target="_blank">View published</ButtonLink> : null}
      </div>
      <div className="grid gap-4 rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="font-medium">{published ? `Published · Revision ${published.number}` : 'Nothing has been published yet.'}</p>
        <p className="text-sm text-muted">{published ? 'Create a draft from the published website to start editing.' : 'Create a draft to start editing.'}</p>
        <form action={createAction} className="flex items-center justify-center gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <Button disabled={creating}>{published ? 'Create draft from published website' : 'Create draft'}</Button>
        </form>
        <Feedback state={createState} />
      </div>
    </div>
  );
}

function ViewportControl({ viewport, onChange }: { viewport: Viewport; onChange: (viewport: Viewport) => void }) {
  return (
    <div role="group" aria-label="Canvas width" className="flex gap-1 rounded-md border border-border p-0.5">
      {(Object.keys(VIEWPORT_LABEL) as Viewport[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={viewport === key}
          className={cx('rounded px-2 py-1 text-xs font-medium transition', FOCUS_RING, viewport === key ? 'bg-foreground text-background' : 'text-muted hover:text-foreground')}
        >
          {VIEWPORT_LABEL[key]}
        </button>
      ))}
    </div>
  );
}

function Editor({ organizationId, working, history, forms, pageTemplates, sectionPatterns }: {
  organizationId: string;
  working: EditorRevision;
  history: RevisionHistoryEntry[];
  forms: FormOption[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
}) {
  const start: WebsiteContent = { pages: working.pages, navigation: working.navigation };
  const [content, setContent] = useState<WebsiteContent>(start);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(start));
  const [pageId, setPageId] = useState(() => (working.pages.find((page) => page.isHome) ?? working.pages[0]!).id);
  const [selected, setSelected] = useState<Selection>('page');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);

  const [saveState, saveAction, saving] = useActionState(saveDraftAction, INITIAL);
  const [submitState, submitAction, submitting] = useActionState(submitRevisionAction, INITIAL);
  const [publishState, publishAction, publishing] = useActionState(publishRevisionAction, INITIAL);

  // A successful save is what makes the just-saved content "the saved draft" — the snapshot Send
  // for review and the exact /preview route both read from here on. Adjusted during render (the
  // "previous props" pattern) rather than an effect, since `saveState` changing IS the render.
  const [processedSaveState, setProcessedSaveState] = useState(saveState);
  if (saveState !== processedSaveState) {
    setProcessedSaveState(saveState);
    if (saveState.success) setSavedSnapshot(JSON.stringify(content));
  }

  const dirty = JSON.stringify(content) !== savedSnapshot;

  // Moving between pages never discards anything (the whole website is one piece of state), but
  // closing the tab with unsaved edits would. Say so, once, the way the browser does.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const isDraft = working.status === 'draft';
  const home = content.pages.find((page) => page.isHome) ?? content.pages[0]!;
  const page = content.pages.find((entry) => entry.id === pageId) ?? home;
  const section = selected === 'page' ? null : page.sections.find((entry) => entry.id === selected.sectionId) ?? null;

  const change = (next: WebsiteContent) => { if (isDraft) setContent(next); };
  const identityFields = (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="revisionId" value={working.id} />
    </>
  );
  const previewBase = `/preview/${organizationId}/${working.id}`;
  const previewHref = page.isHome ? previewBase : `${previewBase}/${page.slug}`;
  const formNames = Object.fromEntries(forms.map((form) => [form.id, form.name]));

  const onAddSection = (added: WebsiteSection) => {
    change(addSection(content, page.id, added));
    setSelected({ sectionId: added.id });
    setLibraryOpen(false);
  };

  const structure = (
    <SiteStructure
      content={content} pageId={page.id} selected={selected} disabled={!isDraft} pageTemplates={pageTemplates}
      onSelectPage={setPageId} onSelect={setSelected}
      onAddPage={(name, templateKey) => {
        const template = pageTemplates.find((entry) => entry.key === templateKey);
        const created = template ? { ...pageFromTemplate(content, template), name } : blankPage(content, name);
        change(addPage(content, created));
        setPageId(created.id);
        setSelected('page');
      }}
      onAddSection={() => setLibraryOpen(true)}
      onMoveSection={(sectionId, direction) => change(moveSection(content, page.id, sectionId, direction))}
      onDuplicateSection={(sectionId) => {
        const result = duplicateSection(content, page.id, sectionId);
        change(result.content);
        if (result.section) setSelected({ sectionId: result.section.id });
      }}
      onRemoveSection={(sectionId) => {
        change(removeSection(content, page.id, sectionId));
        setSelected('page');
      }}
    />
  );

  const inspector = (
    <fieldset disabled={!isDraft} className="contents">
      {section ? (
        <SectionEditor
          // A new section is a new editor: its fields must not inherit the last one's focus or text.
          key={section.id}
          section={section}
          onChange={(next) => change(updateSection(content, page.id, next))}
          organizationId={organizationId}
          forms={forms}
        />
      ) : (
        <PageInspector
          key={page.id}
          content={content}
          page={page}
          onChange={(patch) => change(updatePage(content, page.id, patch))}
          onSetHome={() => change(setHomepage(content, page.id))}
          onDuplicate={() => {
            const result = duplicatePage(content, page.id);
            change(result.content);
            if (result.page) { setPageId(result.page.id); setSelected('page'); }
          }}
          onDelete={() => {
            change(removePage(content, page.id).content);
            setPageId(home.id);
            setSelected('page');
          }}
          onAddToNavigation={() => change(addNavigationPage(content, page.id))}
        />
      )}
    </fieldset>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Revision {working.number} · {isDraft ? 'Draft' : 'In review'}</span>
          {isDraft ? (
            <span className={cx('text-xs font-medium', dirty ? 'text-foreground' : 'text-muted')} role="status">
              {dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          ) : (
            <span className="text-xs text-muted" role="status">Read-only while in review</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2 lg:hidden">
            <PageDrawer>
              <PageDrawerTrigger asChild><Button tone="secondary" size="small">Structure</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader><PageDrawerTitle>Structure</PageDrawerTitle></PageDrawerHeader>
                {structure}
              </PageDrawerContent>
            </PageDrawer>
            <PageDrawer>
              <PageDrawerTrigger asChild><Button tone="secondary" size="small">Inspector</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader><PageDrawerTitle>{section ? 'Section' : 'Page'}</PageDrawerTitle></PageDrawerHeader>
                {inspector}
              </PageDrawerContent>
            </PageDrawer>
          </div>
          <Button type="button" tone="secondary" size="small" onClick={() => setNavigationOpen(true)}>Navigation</Button>
          <ViewportControl viewport={viewport} onChange={setViewport} />
          <WebsiteHistorySheet organizationId={organizationId} history={history} canRestore={false} />
          <ButtonLink tone="secondary" size="small" href={previewHref} target="_blank">
            Preview{dirty ? ' (last saved)' : ''}
          </ButtonLink>
          {isDraft ? (
            <>
              <form action={saveAction}>
                {identityFields}
                <input type="hidden" name="content" value={JSON.stringify(content)} />
                <Button size="small" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              </form>
              <form action={submitAction}>
                {identityFields}
                <Button tone="secondary" size="small" disabled={submitting || dirty} title={dirty ? 'Save your changes before sending for review.' : undefined}>
                  Send for review
                </Button>
              </form>
            </>
          ) : (
            <form action={publishAction}>
              {identityFields}
              <Button size="small" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</Button>
            </form>
          )}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Feedback state={saveState} />
        <Feedback state={submitState} />
        <Feedback state={publishState} />
      </div>
      {!isDraft ? (
        <Hint>Review the exact preview before publishing. Publishing changes every page and the navigation of the public website together.</Hint>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <div className="hidden rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-4 lg:block lg:self-start">
          {structure}
        </div>

        <div className="min-w-0">
          <WebsiteCanvas page={page} selected={selected} onSelect={setSelected} viewport={viewport} formNames={formNames} />
        </div>

        <div className={cx('hidden rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:block lg:self-start', !isDraft && 'opacity-60')}>
          {inspector}
        </div>
      </div>

      <SectionLibrary open={libraryOpen} onOpenChange={setLibraryOpen} forms={forms} patterns={sectionPatterns} onAdd={onAddSection} />
      <NavigationEditor
        open={navigationOpen} onOpenChange={setNavigationOpen} content={content} disabled={!isDraft}
        onAddPage={(id) => change(addNavigationPage(content, id))}
        onAddExternal={() => change(addNavigationExternal(content))}
        onChange={(item) => change(updateNavigationItem(content, item))}
        onMove={(id, direction) => change(moveNavigationItem(content, id, direction))}
        onRemove={(id) => change(removeNavigationItem(content, id))}
      />
    </div>
  );
}

/**
 * Studio's Website workbench: Structure, Canvas and Inspector over one whole website, a toolbar that
 * knows whether there is a draft, and the review → publish path. With no website at all it offers to
 * create one; with a published website and no draft, to start one.
 */
export function WebsiteWorkbench({ organizationId, hasWebsite, working, published, history, forms, siteTemplates, pageTemplates, sectionPatterns }: {
  organizationId: string;
  hasWebsite: boolean;
  forms: FormOption[];
  working: EditorRevision | null;
  published: EditorRevision | null;
  history: RevisionHistoryEntry[];
  siteTemplates: SiteTemplate[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
}) {
  if (!hasWebsite) return <CreateWebsite organizationId={organizationId} templates={siteTemplates} />;
  if (!working) return <NoDraftState organizationId={organizationId} published={published} history={history} />;
  return (
    <Editor
      // Local editing state is only meant to initialize once per revision; keying on the revision
      // id forces a fresh mount when a draft appears, is replaced, or moves to a different id.
      key={working.id}
      organizationId={organizationId} working={working} history={history} forms={forms}
      pageTemplates={pageTemplates} sectionPatterns={sectionPatterns}
    />
  );
}
