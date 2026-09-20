'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import {
  CONNECTOR_AUTH_METHODS,
  CONNECTOR_CAPABILITIES,
  CONNECTOR_CONNECTION_METHODS,
  CONNECTOR_STATUSES,
  type Connector,
} from '@/lib/domain/integrations/connectors';
import {
  removeConnectorAppAction,
  saveConnectorAction,
  saveConnectorAppAction,
  uploadLogoAction,
  type ConnectorState,
} from '@/app/(platform)/platform/integrations/actions';

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

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </div>
  );
}

/**
 * One form for both creating and editing a connector. Operational fields and public copy sit in
 * separate fieldsets on purpose: an admin can rewrite the marketing description without touching
 * anything that runs (D55).
 */
export function ConnectorForm({ connector }: { connector: Connector | null }) {
  const [state, action, pending] = useActionState(saveConnectorAction, INITIAL);
  const editing = connector !== null;

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-6">
      <input type="hidden" name="mode" value={editing ? 'edit' : 'create'} />
      <input type="hidden" name="iconRef" value={connector?.iconRef ?? ''} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">In the product</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key" htmlFor="key">
            <TextInput id="key" name="key" required maxLength={41} defaultValue={connector?.key} readOnly={editing} pattern="[a-z][a-z0-9_]*" />
            {editing ? <Hint>A key never changes: businesses and public addresses hold it.</Hint> : null}
          </Field>
          <Field label="Name" htmlFor="name">
            <TextInput id="name" name="name" required maxLength={120} defaultValue={connector?.name} />
          </Field>
        </div>
        <Field label="Description shown to a business" htmlFor="description">
          <TextInput id="description" name="description" maxLength={500} defaultValue={connector?.description} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category" htmlFor="category">
            <TextInput id="category" name="category" required maxLength={60} defaultValue={connector?.category} />
          </Field>
          <Field label="Suite" htmlFor="suite">
            <TextInput id="suite" name="suite" maxLength={60} defaultValue={connector?.suite ?? ''} placeholder="Optional" />
          </Field>
          <Field label="Display order" htmlFor="displayOrder">
            <TextInput id="displayOrder" name="displayOrder" type="number" defaultValue={connector?.displayOrder ?? 0} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status" htmlFor="status">
            <SelectInput id="status" name="status" defaultValue={connector?.status ?? 'planned'}>
              {CONNECTOR_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Authorizes with" htmlFor="authMethod">
            <SelectInput id="authMethod" name="authMethod" defaultValue={connector?.authMethod ?? 'oauth2'}>
              {CONNECTOR_AUTH_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Connects by" htmlFor="connectionMethod">
            <SelectInput id="connectionMethod" name="connectionMethod" defaultValue={connector?.connectionMethod ?? 'native'}>
              {CONNECTOR_CONNECTION_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPublic" defaultChecked={connector?.isPublic ?? false} />
          Public — visible to every business, and eligible for the published catalogue
        </label>
        <div>
          <p className="text-sm">GOLD capabilities it exposes</p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {CONNECTOR_CAPABILITIES.map((capability) => (
              <label key={capability} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="capabilities" value={capability} defaultChecked={connector?.capabilities.includes(capability)} />
                {CAPABILITY_LABEL[capability]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Public copy</legend>
        <Hint>Editing this changes the public integration catalogue and nothing that runs.</Hint>
        <Field label="Public address" htmlFor="marketingSlug">
          <TextInput id="marketingSlug" name="marketingSlug" maxLength={61} defaultValue={connector?.marketingSlug ?? ''} placeholder="google-workspace" />
        </Field>
        <Field label="Summary (200 characters)" htmlFor="marketingSummary">
          <TextInput id="marketingSummary" name="marketingSummary" maxLength={200} defaultValue={connector?.marketingSummary} />
        </Field>
        <Field label="Description" htmlFor="marketingDescription">
          <TextArea id="marketingDescription" name="marketingDescription" rows={5} maxLength={4000} defaultValue={connector?.marketingDescription} />
        </Field>
      </fieldset>

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
      <Field label="Upload a logo" htmlFor="logo">
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

export function AppForm({ connectorKey }: { connectorKey: string }) {
  const [state, action, pending] = useActionState(saveConnectorAppAction, INITIAL);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="connectorKey" value={connectorKey} />
      <Field label="Key" htmlFor="app-key"><TextInput id="app-key" name="key" required maxLength={41} pattern="[a-z][a-z0-9_]*" className="w-32" /></Field>
      <Field label="Name" htmlFor="app-name"><TextInput id="app-name" name="name" required maxLength={120} className="w-40" /></Field>
      <Field label="Description" htmlFor="app-description"><TextInput id="app-description" name="description" maxLength={300} className="w-56" /></Field>
      <Field label="Order" htmlFor="app-order"><TextInput id="app-order" name="displayOrder" type="number" defaultValue={0} className="w-20" /></Field>
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {pending ? 'Saving…' : 'Add or update app'}
      </Button>
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
