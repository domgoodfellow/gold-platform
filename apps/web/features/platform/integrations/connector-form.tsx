'use client';

import { useActionState } from 'react';
import { Checkbox } from '@gold/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@gold/ui/components/field';
import { Button } from '@/components/controls/button';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { ErrorText, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import {
  CONNECTOR_AUTH_METHODS,
  CONNECTOR_CAPABILITIES,
  CONNECTOR_CONNECTION_METHODS,
  CONNECTOR_STATUSES,
  type Connector,
} from '@/lib/domain/integrations/connectors';
import {
  PROVIDER_SERVICE_IMPLEMENTATION_STATES,
  PROVIDER_SERVICE_VENDOR_STATUSES,
} from '@/lib/domain/providers/services';
import { IMPLEMENTATION_STATE_LABEL } from '@/features/catalogue/implementation-state';
import {
  removeConnectorAppAction,
  saveConnectorAction,
  saveConnectorAppAction,
  uploadLogoAction,
  type ConnectorState,
} from '@/app/platform/integrations/actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: ConnectorState = { error: null, saved: false };

const STATUS_LABEL = { planned: 'Planned', beta: 'Beta', live: 'Live' } as const;
const CAPABILITY_LABEL: Record<string, string> = {
  app_connections: 'App connections',
  file_imports: 'File imports',
  data_mapping: 'Data mapping',
  scheduled_sync: 'Scheduled sync',
  triggers_actions: 'Triggers and actions',
  agent_tools: 'Agent tools',
};
const VENDOR_STATUS_LABEL: Record<string, string> = {
  generally_available: 'Generally available',
  preview: 'Preview',
  restricted: 'Restricted',
  legacy: 'Legacy',
};

/**
 * One form for both creating and editing a connector. Operational fields and public copy sit in
 * separate fieldsets on purpose: an admin can rewrite the marketing description without touching
 * anything that runs. Uses the canonical `Field`/`CheckboxField` primitives rather than a
 * second, file-local form abstraction (section 37).
 */
export function ConnectorForm({ connector }: { connector: Connector | null }) {
  const [state, action, pending] = useActionState(saveConnectorAction, INITIAL);
  const editing = connector !== null;

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-6">
      <input type="hidden" name="mode" value={editing ? 'edit' : 'create'} />
      <input type="hidden" name="iconRef" value={connector?.iconRef ?? ''} />

      <FieldSet>
        <FieldLegend>In the product</FieldLegend>
        <FieldGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="key">Key</FieldLabel>
              <TextInput id="key" name="key" required maxLength={41} defaultValue={connector?.key} readOnly={editing} pattern="[a-z][a-z0-9_]*" />
              {editing ? <Hint>A key never changes: businesses and public addresses hold it.</Hint> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <TextInput id="name" name="name" required maxLength={120} defaultValue={connector?.name} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="description">Description shown to a business</FieldLabel>
            <TextInput id="description" name="description" maxLength={500} defaultValue={connector?.description} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <TextInput id="category" name="category" required maxLength={60} defaultValue={connector?.category} />
            </Field>
            <Field>
              <FieldLabel htmlFor="suite">Suite</FieldLabel>
              <TextInput id="suite" name="suite" maxLength={60} defaultValue={connector?.suite ?? ''} placeholder="Optional" />
            </Field>
            <Field>
              <FieldLabel htmlFor="displayOrder">Display order</FieldLabel>
              <TextInput id="displayOrder" name="displayOrder" type="number" defaultValue={connector?.displayOrder ?? 0} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <SelectField id="status" name="status" defaultValue={connector?.status ?? 'planned'} options={[...CONNECTOR_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="authMethod">Authorizes with</FieldLabel>
              <SelectField id="authMethod" name="authMethod" defaultValue={connector?.authMethod ?? 'oauth2'} options={[...CONNECTOR_AUTH_METHODS.map((m) => ({ value: m, label: m }))]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="connectionMethod">Connects by</FieldLabel>
              <SelectField id="connectionMethod" name="connectionMethod" defaultValue={connector?.connectionMethod ?? 'native'} options={[...CONNECTOR_CONNECTION_METHODS.map((m) => ({ value: m, label: m }))]} />
            </Field>
          </div>

          <CheckboxField
            id="isPublic"
            name="isPublic"
            label="Public — visible to every business, and eligible for the published catalogue"
            defaultChecked={connector?.isPublic ?? false}
          />

          <FieldSet className="gap-1">
            {/* Repeated raw Checkbox, not CheckboxField: several boxes share one name
                ("capabilities"), each needing its own `value` — the same reason multi_select's
                custom-field inputs use this shape rather than the single-boolean helper. */}
            <FieldLegend variant="label">What it lets GildOps do</FieldLegend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {CONNECTOR_CAPABILITIES.map((capability) => {
                const id = `capability-${capability}`;
                return (
                  <div key={capability} className="flex items-center gap-2">
                    <Checkbox id={id} name="capabilities" value={capability} defaultChecked={connector?.capabilities.includes(capability)} />
                    <FieldLabel htmlFor={id} className="font-normal">
                      {CAPABILITY_LABEL[capability]}
                    </FieldLabel>
                  </div>
                );
              })}
            </div>
          </FieldSet>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Public copy</FieldLegend>
        <FieldGroup>
          <Hint>Editing this changes the public integration catalogue and nothing that runs.</Hint>
          <Field>
            <FieldLabel htmlFor="marketingSlug">Public address</FieldLabel>
            <TextInput id="marketingSlug" name="marketingSlug" maxLength={61} defaultValue={connector?.marketingSlug ?? ''} placeholder="google-workspace" />
          </Field>
          <Field>
            <FieldLabel htmlFor="marketingSummary">Summary (200 characters)</FieldLabel>
            <TextInput id="marketingSummary" name="marketingSummary" maxLength={200} defaultValue={connector?.marketingSummary} />
          </Field>
          <Field>
            <FieldLabel htmlFor="marketingDescription">Description</FieldLabel>
            <TextArea id="marketingDescription" name="marketingDescription" rows={5} maxLength={4000} defaultValue={connector?.marketingDescription} />
          </Field>
        </FieldGroup>
      </FieldSet>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : editing ? 'Save connector' : 'Create connector'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
      {state.saved ? <Hint role="status">Saved.</Hint> : null}
    </form>
  );
}

export function LogoForm({ connectorKey }: { connectorKey: string }) {
  const [state, action, pending] = useActionState(uploadLogoAction, INITIAL);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="key" value={connectorKey} />
      <Field>
        <FieldLabel htmlFor="logo">Upload a logo</FieldLabel>
        <input id="logo" name="logo" type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" required className="text-sm" />
      </Field>
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {pending ? 'Uploading…' : 'Upload'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
      {state.saved ? <Hint role="status">Logo updated.</Hint> : null}
    </form>
  );
}

/**
 * A child app/API — its own implementation and vendor truth, not inherited from the parent
 * connector (section 11, 38): Google Workspace being eventually "live" must not imply Forms sync
 * or Meet or Admin SDK all work.
 */
export function AppForm({ connectorKey }: { connectorKey: string }) {
  const [state, action, pending] = useActionState(saveConnectorAppAction, INITIAL);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="connectorKey" value={connectorKey} />
      <div className="flex flex-wrap items-end gap-3">
        <Field>
          <FieldLabel htmlFor="app-key">Key</FieldLabel>
          <TextInput id="app-key" name="key" required maxLength={41} pattern="[a-z][a-z0-9_]*" className="w-32" />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-name">Name</FieldLabel>
          <TextInput id="app-name" name="name" required maxLength={120} className="w-40" />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-description">Description</FieldLabel>
          <TextInput id="app-description" name="description" maxLength={300} className="w-56" />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-order">Order</FieldLabel>
          <TextInput id="app-order" name="displayOrder" type="number" defaultValue={0} className="w-20" />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field>
          <FieldLabel htmlFor="app-implementation">GildOps implementation</FieldLabel>
          <SelectField id="app-implementation" name="implementationState" size="small" defaultValue="planned" className="w-36" options={[...PROVIDER_SERVICE_IMPLEMENTATION_STATES.map((s) => ({ value: s, label: IMPLEMENTATION_STATE_LABEL[s] }))]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="app-vendor-status">Vendor status</FieldLabel>
          <SelectField id="app-vendor-status" name="vendorStatus" size="small" defaultValue="generally_available" className="w-40" options={[...PROVIDER_SERVICE_VENDOR_STATUSES.map((s) => ({ value: s, label: VENDOR_STATUS_LABEL[s] }))]} />
        </Field>
        <Field className="flex-1">
          <FieldLabel htmlFor="app-docs">Docs URL</FieldLabel>
          <TextInput id="app-docs" name="docsUrl" type="url" maxLength={500} placeholder="Optional" />
        </Field>
        <Button type="submit" tone="secondary" size="small" disabled={pending}>
          {pending ? 'Saving…' : 'Add or update app'}
        </Button>
      </div>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function RemoveAppButton({ connectorKey, appKey }: { connectorKey: string; appKey: string }) {
  return (
    <form action={removeConnectorAppAction}>
      <input type="hidden" name="connectorKey" value={connectorKey} />
      <input type="hidden" name="key" value={appKey} />
      <Button type="submit" tone="text" size="tiny">Remove</Button>
    </form>
  );
}
