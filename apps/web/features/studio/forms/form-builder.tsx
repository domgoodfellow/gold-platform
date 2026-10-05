'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FormDefinitionSchema, formIsPublishable, type FormDefinition, type FormField } from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { FormRenderer, type FormValues } from '@/features/forms/form-renderer';
import { FormDistribution } from './form-distribution';
import type { FormEditorState } from '@/lib/domain/forms/forms';
import {
  createFormDraftAction,
  publishFormAction,
  renameFormAction,
  saveFormDraftAction,
  setFormArchivedAction,
  type FormActionResult,
} from '@/app/organizations/[organizationId]/studio/forms/actions';
import { RevisionHistorySheet } from '../website/revision-history-sheet';
import { addField, moveField, removeField, updateField } from './form-editing';
import { FieldInspector, FormSettingsInspector } from './form-inspector';
import { FormStructure, type FormSelection } from './form-structure';

const snapshot = (name: string, definition: FormDefinition) => JSON.stringify({ name, definition });

/**
 * The form workbench: questions on the left, the live form in the middle, settings on the right —
 * the same arrangement as the Website workbench, and the middle pane is the very renderer a
 * visitor's page uses. Editing only ever touches a draft revision; the published one keeps being
 * served until Publish is pressed, and that is also the only moment the public form changes.
 */
export function FormBuilder({ organizationId, state, distribution }: {
  organizationId: string;
  state: FormEditorState;
  distribution: { origin: string; organizationSlug: string | null; siteHostname: string | null };
}) {
  const router = useRouter();
  const { form, working, published, history } = state;
  const [name, setName] = useState(form.name);
  const [definition, setDefinition] = useState<FormDefinition | null>(working?.definition ?? null);
  const [saved, setSaved] = useState(() => snapshot(form.name, working?.definition ?? ({} as FormDefinition)));
  const [selected, setSelected] = useState<FormSelection>('form');
  const [previewValues, setPreviewValues] = useState<FormValues>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const finish = (result: FormActionResult, success: string, after?: () => void) => {
    if (result.error) { setMessage({ tone: 'error', text: result.error }); return; }
    setMessage({ tone: 'info', text: success });
    after?.();
  };

  const run = (work: () => Promise<FormActionResult>, success: string, after?: () => void) =>
    startTransition(async () => finish(await work(), success, after));

  const archivedBar = form.archived ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary p-4">
      <p className="text-sm">This form is archived. It is not shown to visitors and cannot be edited.</p>
      <Button tone="secondary" size="small" disabled={pending} onClick={() => run(() => setFormArchivedAction({ organizationId, formId: form.id, archived: false }), 'Form restored.', () => router.refresh())}>Restore</Button>
    </div>
  ) : null;

  const publicLink = published ? (
    <ButtonLink tone="secondary" size="small" href={`/f/${form.publicKey}`} target="_blank" rel="noreferrer">Open public form</ButtonLink>
  ) : null;
  const distribute = (
    <FormDistribution
      organizationId={organizationId}
      formId={form.id}
      formSlug={form.slug}
      publicKey={form.publicKey}
      organizationSlug={distribution.organizationSlug}
      siteHostname={distribution.siteHostname}
      origin={distribution.origin}
      published={published !== null}
      placements={state.placements}
    />
  );

  // No draft: the form is read as published, and editing begins by making a draft copy.
  if (!working || !definition) {
    return (
      <div className="grid gap-4">
        {archivedBar}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">{published ? `Published · Revision ${published.number}` : 'Not published'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RevisionHistorySheet history={history} />
            {publicLink}
            {distribute}
            <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/studio/forms/${form.id}/submissions`}>Submissions</ButtonLink>
            {!form.archived ? (
              <>
                <Button size="small" disabled={pending} onClick={() => run(() => createFormDraftAction({ organizationId, formId: form.id }), 'Draft ready.', () => router.refresh())}>
                  {published ? 'Edit form' : 'Create draft'}
                </Button>
                <Button tone="secondary" size="small" disabled={pending} onClick={() => run(() => setFormArchivedAction({ organizationId, formId: form.id, archived: true }), 'Form archived.', () => router.refresh())}>Archive</Button>
              </>
            ) : null}
          </div>
        </div>
        {message ? (message.tone === 'error' ? <ErrorText role="alert">{message.text}</ErrorText> : <Hint role="status">{message.text}</Hint>) : null}
        {published ? (
          <div className="mx-auto w-full max-w-xl rounded-lg border border-border bg-surface p-6">
            <FormRenderer definition={published.definition} values={previewValues} onChange={(id, value) => setPreviewValues((current) => ({ ...current, [id]: value }))} />
          </div>
        ) : null}
      </div>
    );
  }

  const dirty = snapshot(name, definition) !== saved;
  const parsed = FormDefinitionSchema.safeParse(definition);
  const readyToPublish = parsed.success && formIsPublishable(parsed.data);
  const selectedField = selected === 'form' ? null : definition.fields.find((field) => field.id === selected) ?? null;

  const editDefinition = (next: FormDefinition) => setDefinition(next);

  const structure = (
    <FormStructure
      definition={definition}
      selected={selectedField ? selected : 'form'}
      disabled={form.archived}
      onSelect={setSelected}
      onAdd={(type) => {
        const result = addField(definition, type);
        editDefinition(result.definition);
        if (result.fieldId) setSelected(result.fieldId);
      }}
      onMove={(fieldId, delta) => editDefinition(moveField(definition, fieldId, delta))}
      onRemove={(fieldId) => {
        editDefinition(removeField(definition, fieldId));
        if (selected === fieldId) setSelected('form');
      }}
    />
  );

  const inspector = selectedField ? (
    <FieldInspector key={selectedField.id} field={selectedField} onChange={(next: FormField) => editDefinition(updateField(definition, selectedField.id, next))} />
  ) : (
    <FormSettingsInspector definition={definition} name={name} onName={setName} onChange={editDefinition} />
  );

  const save = async (): Promise<FormActionResult> => {
    // The name is its own door; the definition is the draft revision. Both are saved, so what is on
    // screen is what is stored.
    if (name.trim() !== form.name) {
      const renamed = await renameFormAction({ organizationId, formId: form.id, name });
      if (renamed.error) return renamed;
    }
    return saveFormDraftAction({ organizationId, formId: form.id, revisionId: working.id, definition });
  };

  return (
    <div className="grid gap-4">
      {archivedBar}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            Revision {working.number} · Draft{published ? ` · Revision ${published.number} is live` : ' · Not published'}
          </span>
          <span className={cx('text-xs font-medium', dirty ? 'text-foreground' : 'text-muted')} role="status">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2 lg:hidden">
            <PageDrawer>
              <PageDrawerTrigger asChild><Button tone="secondary" size="small">Questions</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader><PageDrawerTitle>Questions</PageDrawerTitle></PageDrawerHeader>
                {structure}
              </PageDrawerContent>
            </PageDrawer>
            <PageDrawer>
              <PageDrawerTrigger asChild><Button tone="secondary" size="small">Settings</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader><PageDrawerTitle>{selectedField ? 'Question' : 'Form settings'}</PageDrawerTitle></PageDrawerHeader>
                {inspector}
              </PageDrawerContent>
            </PageDrawer>
          </div>
          <RevisionHistorySheet history={history} />
          {publicLink}
          {distribute}
          <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/studio/forms/${form.id}/submissions`}>Submissions</ButtonLink>
          <Button tone="secondary" size="small" disabled={pending || !dirty || form.archived} onClick={() => run(save, 'Draft saved.', () => { setSaved(snapshot(name, definition)); router.refresh(); })}>
            {pending ? 'Working…' : 'Save'}
          </Button>
          <Button
            size="small"
            disabled={pending || form.archived || !readyToPublish}
            title={readyToPublish ? undefined : parsed.success ? 'Add at least one question before publishing.' : 'Fix the highlighted problem before publishing.'}
            onClick={() => run(async () => {
              const renamed = name.trim() !== form.name ? await renameFormAction({ organizationId, formId: form.id, name }) : { error: null };
              if (renamed.error) return renamed;
              return publishFormAction({ organizationId, formId: form.id, revisionId: working.id, definition });
            }, 'Published. Visitors now see this version.', () => router.refresh())}
          >
            Publish
          </Button>
        </div>
      </div>

      {message ? (message.tone === 'error' ? <ErrorText role="alert">{message.text}</ErrorText> : <Hint role="status">{message.text}</Hint>) : null}
      {!parsed.success ? <ErrorText role="alert">{parsed.error.issues[0]?.message ?? 'The form is not valid.'}</ErrorText> : null}
      {published ? <Hint>Visitors keep seeing Revision {published.number} until you publish this draft.</Hint> : null}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <div className="hidden rounded-lg border border-border bg-surface p-3 lg:sticky lg:top-4 lg:block lg:self-start">{structure}</div>

        <div className="min-w-0">
          <div className="mx-auto w-full max-w-xl rounded-lg border border-border bg-surface p-6">
            <p className="mb-4 text-xs uppercase tracking-wide text-subtle">Preview · the form as a visitor sees it</p>
            <FormRenderer definition={definition} values={previewValues} onChange={(id, value) => setPreviewValues((current) => ({ ...current, [id]: value }))} />
          </div>
        </div>

        <div className="hidden rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:block lg:self-start">{inspector}</div>
      </div>
    </div>
  );
}
