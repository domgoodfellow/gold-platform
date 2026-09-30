'use client';

import { useActionState, useState } from 'react';
import type { PublicHomepageSection, PublicHomepageSections } from '@gold/schemas';
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
import type { EditorRevision } from '@/lib/domain/public-site/public-site';
import {
  createDraftAction,
  publishRevisionAction,
  saveDraftAction,
  submitRevisionAction,
  type WebsiteActionState,
} from '@/app/organizations/[organizationId]/studio/website/actions';
import { WebsiteStructure, type StructureSelection } from './website-structure';
import { WebsiteCanvas, VIEWPORT_LABEL, type Viewport } from './website-canvas';
import { PageInspector, SectionInspector } from './website-inspector';
import { RevisionHistorySheet, type HistoryEntry } from './revision-history-sheet';

const INITIAL: WebsiteActionState = { error: null };

function snapshot(seoTitle: string, seoDescription: string, sections: PublicHomepageSections) {
  return JSON.stringify({ seoTitle, seoDescription, sections });
}

function Feedback({ state }: { state: WebsiteActionState }) {
  if (state.error) return <ErrorText>{state.error}</ErrorText>;
  if (state.success) return <Hint>{state.success}</Hint>;
  return null;
}

/**
 * No working revision yet: the pre-workbench state. Published state is named so a business
 * publishing for the first time and one refining an already-live page read differently.
 */
function NoDraftState({ organizationId, published, history }: { organizationId: string; published: EditorRevision | null; history: HistoryEntry[] }) {
  const [createState, createAction, creating] = useActionState(createDraftAction, INITIAL);
  return (
    <div className="grid gap-4">
      {(published || history.length > 0) ? (
        <div className="flex justify-end gap-2">
          <RevisionHistorySheet history={history} />
          {published ? <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${published.id}`} target="_blank">View published</ButtonLink> : null}
        </div>
      ) : null}
      <div className="grid gap-4 rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="font-medium">
          {published ? `Published · Revision ${published.number}` : 'No website has been published yet.'}
        </p>
        <p className="text-sm text-muted">
          {published ? 'Create a draft from the published page to start editing.' : 'Create a first draft to start building the homepage.'}
        </p>
        <form action={createAction} className="flex items-center justify-center gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <Button disabled={creating}>{published ? 'Create draft from published page' : 'Create homepage draft'}</Button>
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

export function WebsiteWorkbench({ organizationId, working, published, history }: {
  organizationId: string;
  working: EditorRevision | null;
  published: EditorRevision | null;
  history: HistoryEntry[];
}) {
  const [sections, setSections] = useState<PublicHomepageSections>(working?.sections ?? ([] as unknown as PublicHomepageSections));
  const [seoTitle, setSeoTitle] = useState(working?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(working?.seoDescription ?? '');
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(working?.seoTitle ?? '', working?.seoDescription ?? '', working?.sections ?? ([] as unknown as PublicHomepageSections)));
  const [selected, setSelected] = useState<StructureSelection>('page');
  const [viewport, setViewport] = useState<Viewport>('desktop');

  const [saveState, saveAction, saving] = useActionState(saveDraftAction, INITIAL);
  const [submitState, submitAction, submitting] = useActionState(submitRevisionAction, INITIAL);
  const [publishState, publishAction, publishing] = useActionState(publishRevisionAction, INITIAL);

  // A successful save is what makes the just-saved content "the saved draft" — the snapshot Send
  // for review and the exact /preview route both read from here on. Adjusted during render (the
  // "previous props" pattern) rather than an effect, since `saveState` changing IS the render.
  const [processedSaveState, setProcessedSaveState] = useState(saveState);
  if (saveState !== processedSaveState) {
    setProcessedSaveState(saveState);
    if (saveState.success) setSavedSnapshot(snapshot(seoTitle, seoDescription, sections));
  }

  const dirty = snapshot(seoTitle, seoDescription, sections) !== savedSnapshot;

  if (!working) return <NoDraftState organizationId={organizationId} published={published} history={history} />;

  const identityFields = (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="revisionId" value={working.id} />
    </>
  );

  const isDraft = working.status === 'draft';
  const previewHref = `/preview/${organizationId}/${working.id}`;

  const inspectorContent = (
    <fieldset disabled={!isDraft} className="contents">
      {selected === 'page' ? (
        <PageInspector seoTitle={seoTitle} seoDescription={seoDescription} onSeoTitle={setSeoTitle} onSeoDescription={setSeoDescription} />
      ) : (
        (() => {
          const index = sections.findIndex((section) => section.kind === selected);
          const section = sections[index];
          if (!section) return null;
          return (
            <SectionInspector
              section={section}
              onChange={(next: PublicHomepageSection) => setSections(sections.map((entry, i) => i === index ? next : entry) as PublicHomepageSections)}
            />
          );
        })()
      )}
    </fieldset>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">Website</span>
          <span className="text-sm text-muted">Revision {working.number} · {isDraft ? 'Draft' : 'In review'}</span>
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
                <WebsiteStructure sections={sections} selected={selected} onSelect={setSelected} />
              </PageDrawerContent>
            </PageDrawer>
            <PageDrawer>
              <PageDrawerTrigger asChild><Button tone="secondary" size="small">Inspector</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader><PageDrawerTitle>{selected === 'page' ? 'Page' : 'Section'}</PageDrawerTitle></PageDrawerHeader>
                {inspectorContent}
              </PageDrawerContent>
            </PageDrawer>
          </div>
          <ViewportControl viewport={viewport} onChange={setViewport} />
          <RevisionHistorySheet history={history} />
          <ButtonLink tone="secondary" size="small" href={previewHref} target="_blank">
            Preview{dirty ? ' (last saved)' : ''}
          </ButtonLink>
          {isDraft ? (
            <>
              <form action={saveAction}>
                {identityFields}
                <input type="hidden" name="sections" value={JSON.stringify(sections)} />
                <input type="hidden" name="seoTitle" value={seoTitle} />
                <input type="hidden" name="seoDescription" value={seoDescription} />
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
        <Hint>Review the exact preview before publishing. Publishing archives the previous revision and changes the public site.</Hint>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        <div className="hidden rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-4 lg:block lg:self-start">
          <WebsiteStructure sections={sections} selected={selected} onSelect={setSelected} />
        </div>

        <div className="min-w-0">
          <WebsiteCanvas sections={sections} selected={selected} onSelect={setSelected} viewport={viewport} />
        </div>

        <div className={cx('hidden rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:block lg:self-start', !isDraft && 'opacity-60')}>
          {inspectorContent}
        </div>
      </div>
    </div>
  );
}
