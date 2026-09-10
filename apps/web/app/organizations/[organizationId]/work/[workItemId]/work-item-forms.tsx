'use client';

import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import type { CustomValues, FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import {
  addChecklistItemAction,
  addPricedLineAction,
  issueInvoiceAction,
  recordCostAction,
  recordPaymentAction,
  requestCardPaymentAction,
  recordTimeAction,
  removePricedLineAction,
  setChecklistItemDoneAction,
  updateWorkItemAction,
  type WorkItemActionState,
} from './actions';

const INITIAL: WorkItemActionState = { error: null };

export function ToggleChecklistItemForm({
  organizationId,
  workItemId,
  checklistItemId,
  label,
  done,
}: {
  organizationId: string;
  workItemId: string;
  checklistItemId: string;
  label: string;
  done: boolean;
}) {
  const [state, formAction, pending] = useActionState(setChecklistItemDoneAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="checklistItemId" value={checklistItemId} />
      <input type="hidden" name="done" value={done ? '0' : '1'} />

      <Button type="submit" disabled={pending} aria-pressed={done} tone="secondary" size="tiny">
        {done ? '☑' : '☐'}
      </Button>
      <span className={done ? 'text-sm line-through text-subtle' : 'text-sm'}>{label}</span>

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function AddChecklistItemForm({
  organizationId,
  workItemId,
  position,
}: {
  organizationId: string;
  workItemId: string;
  position: number;
}) {
  const [state, formAction, pending] = useActionState(addChecklistItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="position" value={position} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="A step, e.g. Photograph the meter"
          aria-label="Step"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Adding…' : 'Add step'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function RecordTimeForm({
  organizationId,
  workItemId,
  resources,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(recordTimeAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          name="startedAt"
          type="datetime-local"
          aria-label="Started at"
          className="px-2 py-1 text-xs"
        />
        <TextInput
          name="endedAt"
          type="datetime-local"
          aria-label="Ended at"
          className="px-2 py-1 text-xs"
        />
        <OptionalSelect name="resourceId" label="Worked by" options={resources} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="note"
          type="text"
          maxLength={1000}
          placeholder="What was done (optional)"
          aria-label="Note"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Recording…' : 'Record time'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function RecordCostForm({
  organizationId,
  workItemId,
  currency,
}: {
  organizationId: string;
  workItemId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordCostAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="description"
          type="text"
          required
          maxLength={200}
          placeholder="What was spent on, e.g. Replacement valve"
          aria-label="Description"
          className="flex-1"
        />
        {/* Minor units, asked for as minor units. The alternative — accepting 12.50 and
            multiplying by 100 — is where a rounding bug enters and is not found until a
            reconciliation months later. The currency is the organization's and is not a
            field here: a caller does not assert what a business trades in. */}
        <TextInput
          name="amountMinor"
          type="number"
          required
          step={1}
          placeholder={`Amount in minor units (${currency})`}
          aria-label={`Amount in minor units, ${currency}`}
          className="flex-1"
        />
        {/* Optional, and empty means today. A receipt is often entered days after the fuel
            was bought, and before this field the row claimed to be from whenever somebody
            got round to typing it. The table has always had somewhere to put the real date;
            nothing could write it. */}
        <TextInput
          name="incurredAt"
          type="date"
          aria-label="Date the cost was incurred"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Recording…' : 'Record cost'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Put something from the catalogue on this job.
 *
 * There is no amount input, and its absence is the feature. A quantity and an item is all a
 * caller supplies; the price is copied from the catalogue by the database. Somebody who
 * should be able to type an amount onto a job is asking for a cost, which is a different form
 * a few sections up, and a different thing (`roadmap.md` M2 on why a cost is not a price).
 */
export function AddPricedLineForm({
  organizationId,
  workItemId,
  items,
}: {
  organizationId: string;
  workItemId: string;
  items: PriceBookItem[];
}) {
  const [state, formAction, pending] = useActionState(addPricedLineAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <SelectInput
        name="priceBookItemId"
        required
        aria-label="Priced item"
        size="small"
        className="min-w-0 flex-1"
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · per {item.unit}
          </option>
        ))}
      </SelectInput>
      <TextInput
        name="quantity"
        type="number"
        required
        min={1}
        step={1}
        defaultValue={1}
        aria-label="Quantity"
        size="small"
        className="w-20"
      />
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        {pending ? 'Adding…' : 'Add to quote'}
      </Button>

      <ErrorText role="alert" className="w-full">{state.error}</ErrorText>
    </form>
  );
}

/** Strike one line off. A quote changes by removal and re-adding, never by amendment. */
export function RemovePricedLineForm({
  organizationId,
  workItemId,
  lineId,
  description,
}: {
  organizationId: string;
  workItemId: string;
  lineId: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(removePricedLineAction, INITIAL);
  const formId = `remove-priced-line-${lineId}`;

  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="lineId" value={lineId} />
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove line"
        description={`Remove "${description}" from this quote?`}
        ariaLabel={`Remove ${description}`}
        tone="text"
        size="tiny"
        pending={pending}
        className="opacity-60 disabled:opacity-30"
      />
      {state.error ? (
        <span role="alert" className="ml-2 text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Correct a job's details.
 *
 * **What is missing from this form is the design.** There is no status select and no resource
 * select, because those are `work_item.transition` and `work_item.schedule` — separate
 * capabilities, plausibly separate people, with their own forms on this screen. The column
 * grant would refuse them from here even if somebody added the inputs, which is what makes
 * the omission a guarantee rather than a convention.
 *
 * Every reference keeps a "none" option: a job attached to the wrong customer has to be
 * detachable, so clearing one is an edit rather than a gap in the form.
 */
export function EditWorkItemForm({
  organizationId,
  workItem,
  customers,
  locations,
  assets,
  assetsEnabled,
  definitions,
}: {
  organizationId: string;
  workItem: WorkItem;
  customers: SelectOption[];
  locations: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(updateWorkItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItem.id} />

      <TextInput
        name="title"
        type="text"
        required
        maxLength={300}
        defaultValue={workItem.title}
        aria-label="Title"
        className="flex-1"
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <OptionalSelect
          name="customerId"
          label="Customer"
          options={customers}
          value={workItem.customer?.id}
        />
        <OptionalSelect
          name="locationId"
          label="Location"
          options={locations}
          value={workItem.location?.id}
        />
        {assetsEnabled ? (
          <OptionalSelect name="assetId" label="About" options={assets} value={workItem.asset?.id} />
        ) : null}
      </div>

      <CustomFieldInputs definitions={definitions} values={workItem.custom as CustomValues} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save details'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Turn the quote above into an invoice.
 *
 * The only fields are two dates, and everything absent from this form is deliberate: no
 * amount, no lines, no currency, no invoice number. `issue_invoice` copies the quote and takes
 * the next number for this business, so nothing a person types can change what the document
 * says — which is what makes it a snapshot rather than a view of the quote.
 *
 * **The invoice date is a field and the number is not**, which looks inconsistent and is not.
 * A date is a claim about when the work is being billed for, and billing last month's work in
 * arrears is ordinary; a number is this business's own sequence and belongs to the platform to
 * hand out. Numbers follow the order invoices were raised in, so back-dating one out of order
 * puts them out of step — the business's to notice, because the alternative is renumbering
 * documents that have already been sent.
 */
export function IssueInvoiceForm({
  organizationId,
  workItemId,
}: {
  organizationId: string;
  workItemId: string;
}) {
  const [state, formAction, pending] = useActionState(issueInvoiceAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 text-sm">
          <span className="text-muted">Dated</span>
          {/* Optional, and empty means today — which is what every invoice raised as the work
              finishes wants. It is here for the business that bills a month in arrears. */}
          <TextInput name="issuedAt" type="date" aria-label="Invoice date" className="flex-1" />
        </label>
        <label className="flex flex-1 items-center gap-2 text-sm">
          <span className="text-muted">Due</span>
          {/* Optional. A business that invoices on delivery has no due date to give, and an
              invented default would be this platform deciding that business's terms. */}
          <TextInput name="dueAt" type="date" aria-label="Due date" className="flex-1" />
        </label>
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Issuing…' : 'Issue invoice'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Write down that money arrived.
 *
 * There is no payment-method field, and there is no provider field. A payment somebody was
 * handed names nobody; one that came from a processor is written by that processor, and this
 * form is not it.
 */
export function RecordPaymentForm({
  organizationId,
  workItemId,
  invoiceId,
  currency,
}: {
  organizationId: string;
  workItemId: string;
  invoiceId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordPaymentAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Minor units, for the reason the cost form gives. Signed, and negative is allowed:
            a payment recorded wrongly is corrected by recording its reverse, because there is
            no update policy on the table. */}
        <TextInput
          name="amountMinor"
          type="number"
          required
          step={1}
          placeholder={`Amount in minor units (${currency})`}
          aria-label={`Amount in minor units, ${currency}`}
          className="flex-1"
        />
        <TextInput
          name="note"
          type="text"
          maxLength={1000}
          placeholder="Note, e.g. cash on the driveway"
          aria-label="Note"
          className="flex-1"
        />
        {/* **This field was missing and its action always read it.** `recordPaymentAction` has
            passed `receivedAt` since invoices arrived, and there was nothing on screen to fill
            it, so every payment was stamped with the moment it was entered — the same gap the
            cost and invoice forms above just closed, on the one of the three whose domain
            function already took the argument. Optional; empty means now. */}
        <TextInput
          name="receivedAt"
          type="date"
          aria-label="Date the payment was received"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Recording…' : 'Record payment'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Ask a processor to collect what is outstanding.
 *
 * There is no amount field, for the reason the invoice form has no lines: the figure is
 * `invoiceStanding`'s, and a form that could name one could ask a customer for a number this
 * platform does not stand behind.
 *
 * The link is rendered rather than followed automatically. An operator taking payment over the
 * phone reads it out or sends it on; a redirect would assume the payer is the person at the
 * keyboard, which for a mobile business is usually wrong.
 */
export function RequestCardPaymentForm({
  organizationId,
  workItemId,
}: {
  organizationId: string;
  workItemId: string;
}) {
  const [state, formAction, pending] = useActionState(requestCardPaymentAction, {
    error: null,
    payUrl: null,
  });

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <Button type="submit" disabled={pending} tone="secondary" className="w-fit text-sm">
        {pending ? 'Asking…' : 'Take card payment'}
      </Button>

      {state.payUrl ? (
        <p className="text-sm">
          <a
            href={state.payUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Payment link
          </a>
          <span className="text-subtle">
            {' '}
            — send this to the customer. Nothing is recorded until the processor confirms it.
          </span>
        </p>
      ) : null}

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
