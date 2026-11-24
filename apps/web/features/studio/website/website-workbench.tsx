'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { PageTemplate, SectionPattern, SiteTemplate, WebsiteContent, WebsiteSection } from '@gold/schemas';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { Button, ButtonLink } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText } from '@/components/controls/inputs';
import { ViewportControl } from '@/components/display/preview-surface';
import { cx } from '@/components/class-names';
import {
  addNavigationExternal, addNavigationPage, addPage, addSection, blankPage, duplicatePage, duplicateSection,
  moveNavigationItem, moveSection, pageFromTemplate, removeNavigationItem, removePage, removeSection,
  setHomepage, updateNavigationItem, updatePage, updateSection,
} from '@/lib/domain/public-site/composition';
import type { EditorRevision, PublicWebsiteSnapshot, RevisionHistoryEntry, SiteExperience } from '@/lib/domain/public-site/public-site';
import {
  createDraftAction,
  discardDraftAction,
  publishRevisionAction,
  saveDraftAction,
  submitRevisionAction,
  type WebsiteActionState,
} from '@/app/organizations/[organizationId]/studio/website/actions';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { EditorLayout } from '../editor-layout';
import { SiteStructure } from './site-structure';
import { WebsiteCanvas, type Viewport } from './website-canvas';
import { PageInspector } from './page-inspector';
import { SectionEditor } from './section-editors';
import { SectionLibrary } from './section-library';
import { NavigationEditor } from './navigation-editor';
import { CreateWebsite } from './create-website';
import { WebsiteHistorySheet } from './website-history-sheet';
import type { FormOption, Selection } from './types';

const INITIAL: WebsiteActionState = { error: null };

/** What frames the site wherever it is drawn: the experience, the business's public profile, brand and logo. */
export type WebsiteFrame = {
  experience: SiteExperience;
  profile: PublicWebsiteSnapshot['profile'];
  brand: PublicWebsiteSnapshot['brand'];
  logoSrc: string | null;
};

/** Feedback after an action is a toast; a refusal stays on screen beside the control. */
function useActionFeedback(state: WebsiteActionState) {
  useEffect(() => { if (state.success) toast.success(state.success); }, [state]);
}

/** In the business's own time zone, so the server and the browser write the same words. */
export const formatWhen = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

/** Opening history from a link (`?panel=history`), and forgetting the link once it is closed. */
function useHistoryPanel(initiallyOpen: boolean) {
  const [open, setOpen] = useState(initiallyOpen);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('panel')) { url.searchParams.delete('panel'); window.history.replaceState(window.history.state, '', url); }
    }
  };
  return { open, onOpenChange };
}

/** No working revision: the website is published and nothing is being changed. */
function NoDraftState({ organizationId, timezone, published, history, historyOpen }: { organizationId: string; timezone: string; published: EditorRevision | null; history: RevisionHistoryEntry[]; historyOpen: boolean }) {
  const [createState, createAction, creating] = useActionState(createDraftAction, INITIAL);
  useActionFeedback(createState);
  const panel = useHistoryPanel(historyOpen);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <span className="text-sm font-medium">{published ? `Revision ${published.number} · Published` : 'Nothing published'}</span>
        <div className="flex flex-wrap items-center gap-2">
          <WebsiteHistorySheet organizationId={organizationId} timezone={timezone} history={history} workingId={null} publishedId={published?.id ?? null} {...panel} />
          {published ? <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${published.id}`} target="_blank">View published</ButtonLink> : null}
          <form action={createAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <Button size="small" disabled={creating}>{published ? 'Create draft from published website' : 'Create draft'}</Button>
          </form>
        </div>
      </div>
      <ErrorText>{createState.error}</ErrorText>
    </div>
  );
}

/**
 * The working revision's standing against the published one. Only a stale draft — started before
 * the revision visitors now see — gets a persistent alert: publishing it would replace newer content.
 */
function StaleAlert({ organizationId, working, published }: { organizationId: string; working: EditorRevision; published: EditorRevision | null }) {
  if (!working.stale || !published) return null;
  return (
    <Alert variant="warning" data-stale-draft>
      <AlertTitle>Draft is based on an older revision.</AlertTitle>
      <AlertDescription>
        <p>Publishing this draft would replace revision {published.number}.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${published.id}`} target="_blank">View revision {published.number}</ButtonLink>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function Editor({ organizationId, timezone, frame, working, published, history, forms, pageTemplates, sectionPatterns, historyOpen }: {
  organizationId: string;
  timezone: string;
  frame: WebsiteFrame;
  working: EditorRevision;
  published: EditorRevision | null;
  history: RevisionHistoryEntry[];
  forms: FormOption[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
  historyOpen: boolean;
}) {
  const start: WebsiteContent = { pages: working.pages, navigation: working.navigation };
  const [content, setContent] = useState<WebsiteContent>(start);
  const [submittedSnapshot, setSubmittedSnapshot] = useState(() => JSON.stringify(start));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(start));
  const [savedAt, setSavedAt] = useState<string | null>(working.updatedAt ?? null);
  const [pageId, setPageId] = useState(() => (working.pages.find((page) => page.isHome) ?? working.pages[0]!).id);
  const [selected, setSelected] = useState<Selection>('page');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const panel = useHistoryPanel(historyOpen);

  const [saveState, saveAction, saving] = useActionState(saveDraftAction, INITIAL);
  const [submitState, submitAction, submitting] = useActionState(submitRevisionAction, INITIAL);
  const [publishState, publishAction, publishing] = useActionState(publishRevisionAction, INITIAL);
  const [discardState, discardAction, discarding] = useActionState(discardDraftAction, INITIAL);
  useActionFeedback(saveState);
  useActionFeedback(submitState);
  useActionFeedback(publishState);
  useActionFeedback(discardState);

  // A successful save is what makes the just-saved content "the saved draft" — the snapshot Send
  // for review and the exact /preview route both read from here on. Adjusted during render (the
  // "previous props" pattern) rather than an effect, since `saveState` changing IS the render.
  const [processedSaveState, setProcessedSaveState] = useState(saveState);
  if (saveState !== processedSaveState) {
    setProcessedSaveState(saveState);
    if (saveState.success) { setSavedSnapshot(submittedSnapshot); setSavedAt(new Date().toISOString()); }
  }

  const dirty = JSON.stringify(content) !== savedSnapshot;

  useUnsavedChanges(dirty);

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
  const discardFormId = `discard-${working.id}`;
  const replaceFormId = `replace-${working.id}`;

  const onAddSection = (added: WebsiteSection) => {
    change(addSection(content, page.id, added));
    setSelected({ sectionId: added.id });
    setLibraryOpen(false);
  };

  const structure = (
    <SiteStructure
      content={content} pageId={page.id} selected={selected} disabled={!isDraft} pageTemplates={pageTemplates}
      onSelectPage={(id) => { setPageId(id); setSelected('page'); }} onSelect={setSelected}
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

  // The persisted draft and the browser's unsaved edits are different things, said separately.
  const saveStatus = !isDraft
    ? 'Read-only while in review'
    : dirty ? 'Unsaved changes' : savedAt ? `Draft saved ${formatWhen(savedAt, timezone)}` : `Draft created ${formatWhen(working.createdAt, timezone)}`;
  const standing = published
    ? (published.createdSource === 'migration' ? `Revision ${published.number} is published (by a GildOps release)` : `Revision ${published.number} is published`)
    : 'Nothing published';

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium" data-working-revision={working.number}>Revision {working.number} · {isDraft ? 'Draft' : 'In review'}</span>
          <span className={cx('text-xs', dirty ? 'font-medium text-foreground' : 'text-muted')} role="status">{saveStatus}</span>
          <span className="text-xs text-muted" data-published-revision={published?.number}>{standing}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" tone="secondary" size="small" onClick={() => setNavigationOpen(true)}>Navigation</Button>
          <WebsiteHistorySheet organizationId={organizationId} timezone={timezone} history={history} workingId={working.id} publishedId={published?.id ?? null} {...panel} />
          <ButtonLink tone="secondary" size="small" href={previewHref} target="_blank">
            Preview{dirty ? ' (last saved)' : ''}
          </ButtonLink>
          <form id={discardFormId} action={discardAction}>{identityFields}</form>
          <ConfirmSubmit
            formId={discardFormId}
            label="Discard draft"
            confirmLabel={`Discard revision ${working.number}`}
            description={`Revision ${working.number}${dirty ? ' and your unsaved changes' : ''} will no longer be edited or published. It stays in history and can be restored. The published website does not change.`}
            tone="secondary"
            pending={discarding}
          />
          {isDraft ? (
            <>
              <form action={saveAction} onSubmit={() => setSubmittedSnapshot(JSON.stringify(content))}>
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
          ) : working.stale && published ? (
            <>
              <form id={replaceFormId} action={publishAction}>
                {identityFields}
                <input type="hidden" name="replaceNewer" value="true" />
              </form>
              <ConfirmSubmit
                formId={replaceFormId}
                label="Publish"
                confirmLabel={`Replace revision ${published.number}`}
                description={`Revision ${published.number} was published after this draft was started. Publishing revision ${working.number} replaces it on the public website, with every page and the navigation.`}
                tone="primary"
                pending={publishing}
              />
            </>
          ) : (
            <form action={publishAction}>
              {identityFields}
              <Button size="small" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</Button>
            </form>
          )}
        </div>
      </div>
      {[saveState, submitState, publishState, discardState].map((state, index) => <ErrorText key={index}>{state.error}</ErrorText>)}
      <StaleAlert organizationId={organizationId} working={working} published={published} />

      <EditorLayout
        id="website"
        structure={structure}
        inspector={inspector}
        canvasTools={<ViewportControl value={viewport} onChange={setViewport} label="Canvas width" />}
      >
        <WebsiteCanvas
          experience={frame.experience}
          site={{ pages: content.pages, navigation: content.navigation, profile: frame.profile, brand: frame.brand }}
          page={page}
          logoSrc={frame.logoSrc}
          selected={selected}
          onSelect={setSelected}
          viewport={viewport}
          formNames={formNames}
        />
      </EditorLayout>

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
 * names the working and published revisions apart, and the review → publish path. With no website
 * at all it offers to create one; with a published website and no draft, to start one. Opening it,
 * its history or a preview, and changing the canvas width, never creates a revision.
 */
export function WebsiteWorkbench({ organizationId, timezone = 'UTC', hasWebsite, frame, working, published, history, forms, siteTemplates, pageTemplates, sectionPatterns, initialPanel = null }: {
  organizationId: string;
  /** The business's time zone, for every date shown. */
  timezone?: string;
  hasWebsite: boolean;
  frame: WebsiteFrame | null;
  forms: FormOption[];
  working: EditorRevision | null;
  published: EditorRevision | null;
  history: RevisionHistoryEntry[];
  siteTemplates: SiteTemplate[];
  pageTemplates: PageTemplate[];
  sectionPatterns: SectionPattern[];
  /** `history` when the page was opened to review publishing and history. */
  initialPanel?: 'history' | null;
}) {
  if (!hasWebsite || !frame) return <CreateWebsite organizationId={organizationId} templates={siteTemplates} />;
  if (!working) return <NoDraftState organizationId={organizationId} timezone={timezone} published={published} history={history} historyOpen={initialPanel === 'history'} />;
  return (
    <Editor
      // Local editing state is only meant to initialize once per revision; keying on the revision
      // id forces a fresh mount when a draft appears, is replaced, or moves to a different id.
      key={working.id}
      organizationId={organizationId} timezone={timezone} frame={frame} working={working} published={published} history={history} forms={forms}
      pageTemplates={pageTemplates} sectionPatterns={sectionPatterns} historyOpen={initialPanel === 'history'}
    />
  );
}
