'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ArrowRight, FileSpreadsheet, Lock, RefreshCw, UserPlus, UserRoundPlus } from 'lucide-react';
import { GuardedDialog, useGuardedDialogClose } from '@/components/panels/guarded-dialog';
import { Button, ButtonLink } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { ContactIntakeOptions, IntakeChoice } from '@/lib/application/crm/contact-intake';
import type { CreateCustomerState } from '@/app/organizations/[organizationId]/crm/contacts/actions';
import { CreateContactForm } from '@/features/crm/customers/create-contact-form';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';

type View = 'choose' | 'manual' | 'created';
type Identity = 'person' | 'company' | '';
const IntakeContext = createContext<((view?: 'choose' | 'manual', identity?: Identity) => void) | null>(null);

const CARD = 'flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left';
function ChoiceBody({ Icon, title, description, titleId, children }: { Icon: typeof UserPlus; title: string; description: string; titleId?: string; children?: ReactNode }) {
  return <><Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span id={titleId} className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{description}</span>{children}</span></>;
}
function Unavailable({ choice }: { choice: Extract<IntakeChoice, { state: 'unavailable' }> }) {
  return <span className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Lock aria-hidden className="size-3.5" />{choice.reason}</span>;
}

/**
 * The one way into Contacts from CRM: a dialog that offers creating, importing or synchronizing,
 * each evaluated separately (`contactIntakeOptions`). The Dashboard, the Contacts directory and
 * their empty states all open this same instance through `AddContactsTrigger`. Imports and
 * synchronization stay Library's; this only leads there. Manual creation happens inside the dialog,
 * with unsaved-change protection on every way of closing it.
 */
export function ContactIntakeProvider({ organizationId, definitions, options, children, defaultOpen = false, initialType = '' }: {
  organizationId: string; definitions: FieldDefinition[]; options: ContactIntakeOptions; children: ReactNode;
  /** `?create=1` opens straight into manual creation, with `?type=` preselecting the identity. */
  defaultOpen?: boolean; initialType?: Identity;
}) {
  const startManual = defaultOpen && options.manual.state === 'available';
  const [open, setOpen] = useState(startManual);
  const [view, setView] = useState<View>(startManual ? 'manual' : 'choose');
  const [identity, setIdentity] = useState<Identity>(initialType);
  const [created, setCreated] = useState<CreateCustomerState | null>(null);
  const [formKey, setFormKey] = useState(0);

  const show = useCallback((next: 'choose' | 'manual' = 'choose', type: Identity = '') => {
    setView(next === 'manual' && options.manual.state === 'available' ? 'manual' : 'choose'); setIdentity(type); setCreated(null); setFormKey(key => key + 1); setOpen(true);
  }, [options.manual.state]);
  const onCreated = useCallback((state: CreateCustomerState) => { setCreated(state); setView('created'); }, []);
  const base = `/organizations/${organizationId}`;

  return <IntakeContext.Provider value={show}>
    {children}
    <GuardedDialog open={open} onOpenChange={setOpen} discardDescription="The contact you started will not be saved.">
        {view === 'choose' ? <>
          <StepHeader title="Add contacts" description="Choose how these contacts reach GildOps." />
          <DialogBody>
            <ul className="flex flex-col gap-3" aria-label="Ways to add contacts">
              <li>{options.manual.state === 'available'
                ? <button type="button" data-slot="selectable-card" onClick={() => setView('manual')} className={cx(CARD, 'transition-colors hover:bg-hover', FOCUS_RING)}><ChoiceBody Icon={UserRoundPlus} title="Create manually" description="Add a person or company." /><ArrowRight aria-hidden className="size-4 self-center text-muted" /></button>
                : <div aria-disabled="true" className={cx(CARD, 'opacity-70')}><ChoiceBody Icon={UserRoundPlus} title="Create manually" description="Add a person or company."><Unavailable choice={options.manual} /></ChoiceBody></div>}</li>
              <li>{options.import.state === 'available'
                ? <Link href={options.import.href!} data-slot="selectable-card" className={cx(CARD, 'transition-colors hover:bg-hover', FOCUS_RING)}><ChoiceBody Icon={FileSpreadsheet} title="Import records" description="Import a CSV, existing Library file, or saved source.">{options.import.note ? <span className="mt-2 block text-xs text-muted">{options.import.note}</span> : null}</ChoiceBody><ArrowRight aria-hidden className="size-4 self-center text-muted" /></Link>
                : <div aria-disabled="true" className={cx(CARD, 'opacity-70')}><ChoiceBody Icon={FileSpreadsheet} title="Import records" description="Import a CSV, existing Library file, or saved source."><Unavailable choice={options.import} /></ChoiceBody></div>}</li>
              <li><section aria-labelledby="intake-sync" className={cx(CARD, options.sync.state === 'unavailable' && 'opacity-70')}>
                <ChoiceBody Icon={RefreshCw} titleId="intake-sync" title="Connect & synchronize" description="Use a supported external source and review subsequent changes.">
                  {options.sync.state === 'unavailable' ? <Unavailable choice={options.sync} /> : <span className="mt-3 flex flex-col gap-2">
                    {options.sync.sources.length ? <span className="flex flex-col gap-1.5" role="list" aria-label="Synchronized sources">{options.sync.sources.map(source => <span role="listitem" key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary px-3 py-2 text-xs">
                      <span className="min-w-0"><span className="block font-medium">{source.name}</span><span className="text-muted">{source.type} · connection {source.connection.replaceAll('_', ' ')}</span></span>
                      <Link href={source.href} className={cx('font-medium text-accent-text underline underline-offset-4', FOCUS_RING)}>Refresh and review</Link></span>)}</span>
                      : <span className="text-xs text-muted">No worksheet is connected yet.</span>}
                    <span className="text-xs text-muted">Refreshing re-reads the worksheet and opens a review; nothing reaches CRM until you apply it. Removed rows never delete contacts, and local edits are kept. Automatic scheduling is not enabled.</span>
                    {options.sync.connectHref ? <Link href={options.sync.connectHref} className={cx('w-fit text-xs font-medium text-accent-text underline underline-offset-4', FOCUS_RING)}>Connect Google Workspace or Microsoft 365 (beta) in Connections</Link> : null}
                  </span>}
                </ChoiceBody>
              </section></li>
            </ul>
          </DialogBody>
        </> : view === 'manual' ? <CreateContactForm key={formKey} organizationId={organizationId} definitions={definitions} initialType={identity} onCreated={onCreated} />
        : <>
          <StepHeader title="Contact added" description={<><span className="font-medium text-foreground">{created?.name}</span> was added as a {created?.contactType === 'company' ? 'company' : 'person'}.</>} />
          <DialogFooterBar>
            {created?.id ? <ButtonLink tone="primary" href={`${base}/crm/contacts/${created.id}`}>View contact</ButtonLink> : null}
            <Button type="button" tone="secondary" onClick={() => show('manual')}>Add another</Button>
            <Button type="button" tone="text" onClick={() => setOpen(false)} className="sm:mr-auto">Close</Button>
          </DialogFooterBar>
        </>}
    </GuardedDialog>
  </IntakeContext.Provider>;
}

/** The single CRM entry point. It renders nothing outside a provider, so a page without intake shows no dead button. */
export function AddContactsTrigger({ tone = 'primary', children }: { tone?: 'primary' | 'secondary'; children?: ReactNode }) {
  const open = useContext(IntakeContext);
  if (!open) return null;
  return <Button type="button" tone={tone} onClick={() => open()}>{children ?? <><UserPlus aria-hidden /> <BusinessLabel>Add contacts</BusinessLabel></>}</Button>;
}
