'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, UserPlus } from 'lucide-react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import { GuardedDialog, GuardedDialogScope, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { CallListCandidate, CallListOutcome, CallListReviewEntry, CallListTaskDraft } from '@/lib/application/communications/call-list';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { CreateCustomerState } from '@/app/organizations/[organizationId]/crm/contacts/actions';
import { addToCallListAction, callListContactFields, findCallListContacts, reviewCallListContacts } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import { CreateContactForm } from '@/features/crm/customers/create-contact-form';
import { callListAddedMessage } from './add-to-list-menu';
import { CallListTaskFields, type CallListTaskOptions } from './call-list-task-fields';

const STEPS = ['Contacts', 'Call details', 'Review'];
const people = (count: number) => `${count} ${count === 1 ? 'contact' : 'contacts'}`;
type Step = 0 | 1 | 2;
type Chosen = Map<string, CallListCandidate>;
type Result = { outcomes: Record<string, CallListOutcome>; names: Map<string, string> };

/**
 * The Dialer's Add to list, in three steps over one dialog: choose contacts, say why to call them,
 * then review and add. Each contact added becomes one open Call task. Choices and details are kept
 * while moving back and forth and while the search changes; the review reads every chosen contact
 * again, so someone put on the list or left without a phone number since they were picked is shown
 * and skipped rather than added. A member who may add contacts can create one without leaving.
 */
export function AddToCallList({ organizationId, mayCreateContacts = false }: { organizationId: string; mayCreateContacts?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" tone="secondary" size="small" onClick={() => setOpen(true)}><UserPlus aria-hidden /> Add to list</Button>
    {/* A fixed height: loading, searching and moving between steps never resize the dialog. */}
    <GuardedDialog open={open} onOpenChange={setOpen} className="h-[min(92dvh,40rem)]" discardDescription="No one has been added to the call list.">
      {open ? <AddToCallListSteps organizationId={organizationId} mayCreateContacts={mayCreateContacts} onDone={() => setOpen(false)} /> : null}
    </GuardedDialog>
  </>;
}

function AddToCallListSteps({ organizationId, mayCreateContacts, onDone }: { organizationId: string; mayCreateContacts: boolean; onDone: () => void }) {
  const prefix = useId();
  const router = useRouter();
  const close = useGuardedDialogClose();
  const [step, setStep] = useState<Step>(0);
  const [creating, setCreating] = useState<{ definitions: FieldDefinition[] } | null>(null);
  const [creatingError, setCreatingError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // The results and the search they answer: while they differ, a newer search is on its way.
  const [found, setFound] = useState<{ search: string; contacts: CallListCandidate[] } | null>(null);
  const results = found?.contacts ?? null;
  const searching = found?.search !== search;
  const [chosen, setChosen] = useState<Chosen>(() => new Map());
  // A contact just created here, chosen as soon as a search returns them, when they can be called.
  const justCreated = useRef<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState<CallListTaskDraft>({ dueAt: '', ownerMembershipId: '', notes: '' });
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [options, setOptions] = useState<CallListTaskOptions | null>(null);
  const [review, setReview] = useState<CallListReviewEntry[] | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Adding has its own pending state, so the review check finishing is never shown as Adding….
  const [adding, startAdding] = useTransition();
  const dirty = chosen.size > 0 || reason.trim() !== '' || detailsDirty;
  useGuardedDialogDirty(dirty && !result);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void findCallListContacts(organizationId, search)
        .then(answer => {
          if (!active) return;
          setFound({ search, contacts: answer.contacts });
          setError(answer.error);
          const created = answer.contacts.find(contact => contact.id === justCreated.current);
          if (!created) return;
          justCreated.current = null;
          if (created.phone && !created.onList) setChosen(current => new Map(current).set(created.id, created));
        })
        .catch(() => { if (active) { setFound({ search, contacts: [] }); setError('Contacts could not be loaded. Try again.'); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, search, reloads]);

  const toggle = (contact: CallListCandidate, on: boolean) => setChosen(current => {
    const next = new Map(current);
    if (on) next.set(contact.id, contact); else next.delete(contact.id);
    return next;
  });
  const onLoaded = useCallback((loaded: CallListTaskOptions) => setOptions(loaded), []);
  const onDirty = useCallback(() => setDetailsDirty(true), []);

  const startCreating = () => startTransition(async () => {
    setCreatingError(null);
    try {
      const fields = await callListContactFields(organizationId);
      if (fields.error) { setCreatingError(fields.error); return; }
      setCreating({ definitions: fields.definitions });
    } catch {
      setCreatingError('Contact fields could not be loaded. Try again.');
    }
  });
  const stopCreating = useCallback(() => setCreating(null), []);
  const onCreated = useCallback((created: CreateCustomerState) => {
    setCreating(null);
    if (!created.id) return;
    justCreated.current = created.id;
    setSearch(created.name ?? '');
    setReloads(count => count + 1);
    toast.success(`Created ${created.name || 'the contact'}.`);
    router.refresh();
  }, [router]);

  const toReview = () => {
    setError(null);
    setReview(null);
    setStep(2);
    startTransition(checkChosen);
  };
  const checkChosen = async () => {
    try {
      const checked = await reviewCallListContacts(organizationId, [...chosen.keys()]);
      if (checked.error) { setError(checked.error); return; }
      setReview(checked.entries);
    } catch {
      setError('These contacts could not be checked. Go back and try again.');
    }
  };

  const eligible = review?.filter(entry => entry.standing === 'ready') ?? [];
  const add = () => startAdding(async () => {
    setError(null);
    const added = await addToCallListAction(organizationId, { customerIds: eligible.map(entry => entry.id) }, reason, details);
    if (added.error) { setError(added.error); return; }
    toast.success(callListAddedMessage(added));
    router.refresh();
    const skippedAtReview = review?.filter(entry => entry.standing !== 'ready') ?? [];
    const outcomes: Record<string, CallListOutcome> = { ...added.outcomes };
    for (const entry of skippedAtReview) outcomes[entry.id] = entry.standing === 'on-list' ? 'on-list' : 'no-phone';
    // Everyone chosen was added: nothing more to say than the toast. Otherwise show who was skipped.
    if (Object.values(outcomes).every(outcome => outcome === 'added')) { onDone(); return; }
    setResult({ outcomes, names: new Map((review ?? []).map(entry => [entry.id, entry.name])) });
  });

  if (creating) {
    return <GuardedDialogScope dirty={dirty} onCancel={stopCreating}>
      <CreateContactForm organizationId={organizationId} definitions={creating.definitions} onCreated={onCreated} />
    </GuardedDialogScope>;
  }
  if (result) return <AddResult result={result} onDone={onDone} />;

  const dueLabel = details.dueAt ? new Intl.DateTimeFormat('en', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${details.dueAt}:00Z`)) : '';
  const ownerLabel = details.ownerMembershipId ? options?.members.find(member => member.id === details.ownerMembershipId)?.name ?? 'Member' : 'Unassigned';
  const reasonReady = reason.trim() !== '';

  return <>
    <StepHeader title="Add to call list" steps={STEPS} current={step} />
    <DialogBody>
      {/* Steps stay mounted while hidden, so going back never loses a search, a choice or a typed detail. */}
      <div hidden={step !== 0} className={step === 0 ? 'flex h-full min-h-0 flex-col gap-3' : undefined}>
        <FormField id={`${prefix}-search`} label="Find contacts">{p => <TextInput {...p} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email or phone" autoComplete="off" />}</FormField>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" className="mr-auto text-sm text-muted">{chosen.size ? `${people(chosen.size)} chosen` : 'None chosen'}</p>
          {mayCreateContacts ? <Button type="button" tone="text" size="small" disabled={pending} onClick={startCreating}><Plus aria-hidden /> Create contact</Button> : null}
          <ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/crm/contacts`}>Open Contacts</ButtonLink>
        </div>
        <FormError>{creatingError}</FormError>
        <div aria-busy={searching} className="-mx-2 min-h-40 flex-1 overflow-y-auto">
          {results === null ? (error ? null : <p role="status" className="p-3 text-sm text-muted">Loading contacts…</p>) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted">{search.trim() ? 'No contacts match.' : 'No contacts yet.'}</p>
          ) : (
            <ul aria-label="Contacts" className={cx('divide-y divide-border', searching && 'opacity-60')}>
              {results.map(contact => {
                const id = `${prefix}-contact-${contact.id}`;
                const blocked = contact.onList || !contact.phone;
                return <li key={contact.id}>
                  <label htmlFor={id} className={cx('flex items-center gap-3 px-3 py-2', blocked ? 'cursor-default' : 'cursor-pointer hover:bg-hover')}>
                    <Checkbox id={id} checked={contact.onList || chosen.has(contact.id)} disabled={blocked} onCheckedChange={value => toggle(contact, value === true)} />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate text-sm font-medium', blocked && 'text-muted')}>{contact.name}</span>
                      <span className="block truncate text-xs tabular-nums text-muted">{contact.phone ? formatPhoneForDisplay(contact.phone) : 'No phone number'}</span>
                    </span>
                    {contact.onList ? <span className="shrink-0 text-xs text-muted">On the list</span> : null}
                  </label>
                </li>;
              })}
            </ul>
          )}
        </div>
      </div>

      <div hidden={step !== 1} className="space-y-4">
        <p className="text-sm font-medium">{people(chosen.size)} chosen</p>
        <FormField id={`${prefix}-reason`} label="Reason for calling">{p => <TextInput {...p} required value={reason} onChange={event => setReason(event.target.value)} maxLength={200} />}</FormField>
        <CallListTaskFields organizationId={organizationId} value={details} onChange={setDetails} onDirty={onDirty} onLoaded={onLoaded} />
      </div>

      <div hidden={step !== 2} className="space-y-4">
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Reason</dt><dd className="break-words font-medium">{reason.trim()}</dd>
          <dt className="text-muted">Due</dt><dd className="tabular-nums">{dueLabel}{options ? <span className="text-muted"> · {options.timezone}</span> : null}</dd>
          <dt className="text-muted">Owner</dt><dd>{ownerLabel}</dd>
        </dl>
        {review === null ? (error ? null : <p role="status" className="text-sm text-muted">Checking contacts…</p>) : <ReviewGroups entries={review} />}
      </div>
      <FormError>{error}</FormError>
    </DialogBody>
    <DialogFooterBar>
      {step === 0 ? <>
        <Button type="button" disabled={!chosen.size} onClick={() => { setError(null); setStep(1); }}>Next</Button>
        <Button type="button" tone="secondary" onClick={close}>Cancel</Button>
      </> : step === 1 ? <>
        <Button type="button" disabled={!reasonReady || !details.dueAt || pending} onClick={toReview}>Review</Button>
        <Button type="button" tone="secondary" onClick={() => setStep(0)}>Back</Button>
      </> : <>
        <Button type="button" disabled={!eligible.length || pending || adding} onClick={add}>{adding ? 'Adding…' : eligible.length ? `Add ${eligible.length} to list` : 'Add to list'}</Button>
        <Button type="button" tone="secondary" disabled={adding} onClick={() => { setError(null); setStep(1); }}>Back</Button>
      </>}
    </DialogFooterBar>
  </>;
}

const GROUPS: { standing: CallListReviewEntry['standing']; label: (count: number) => string }[] = [
  { standing: 'ready', label: count => `Will be added (${count})` },
  { standing: 'on-list', label: count => `Already on the list (${count})` },
  { standing: 'no-phone', label: count => `No phone number (${count})` },
];

/** The review: who will be added, and who will be skipped and why, as the database has them now. */
function ReviewGroups({ entries }: { entries: CallListReviewEntry[] }) {
  const prefix = useId();
  return <div className="space-y-4">
    {GROUPS.map(({ standing, label }) => {
      const group = entries.filter(entry => entry.standing === standing);
      if (!group.length) return null;
      return <section key={standing} aria-labelledby={`${prefix}-${standing}`}>
        <h3 id={`${prefix}-${standing}`} className="mb-1 text-sm font-medium">{label(group.length)}</h3>
        <ul className="divide-y divide-border">
          {group.map(entry => <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className={cx('min-w-0 truncate', standing !== 'ready' && 'text-muted')}>{entry.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{entry.phone ? formatPhoneForDisplay(entry.phone) : 'No phone number'}</span>
          </li>)}
        </ul>
      </section>;
    })}
  </div>;
}

const OUTCOME_LABEL: Record<CallListOutcome, string> = {
  added: 'Added',
  'on-list': 'Already on the list',
  conflict: 'Added by someone else just now',
  'no-phone': 'No phone number',
};

/** What the add actually did, shown when anyone chosen was not added. */
function AddResult({ result, onDone }: { result: Result; onDone: () => void }) {
  const entries = Object.entries(result.outcomes);
  return <>
    <StepHeader title="Add to call list" steps={STEPS} current={2} />
    <DialogBody>
      <ul aria-label="Result" className="divide-y divide-border">
          {entries.map(([id, outcome]) => <li key={id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className={cx('min-w-0 truncate', outcome !== 'added' && 'text-muted')}>{result.names.get(id) ?? 'Contact'}</span>
            <span className="shrink-0 text-xs text-muted">{OUTCOME_LABEL[outcome]}</span>
          </li>)}
      </ul>
    </DialogBody>
    <DialogFooterBar>
      <Button type="button" onClick={onDone}>Done</Button>
    </DialogFooterBar>
  </>;
}
