'use client';

import { useActionState, useContext, useEffect, useState, useTransition } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { UploadSourceForm } from '@/features/integrations/imports/upload-source-form';
import { ConnectorIcon } from '@/features/integrations/catalogue/connector-icon';
import { contactImportSourcesAction, refreshContactImportAccountAction, importContactWorksheetAction, selectLibraryFileAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';
import { libraryNewImportHref } from '@/lib/route/library';
import type { ContactImportSources } from '@/lib/application/crm/contact-import';
import { ImportSteps } from '@/features/integrations/imports/import-steps';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';

export function ContactImport({ organizationId, initialAccountId = '', oauthError }: { organizationId: string; initialAccountId?: string; oauthError?: string }) {
  const [sources, setSources] = useState<ContactImportSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState('worksheet');
  const [accountId, setAccountId] = useState(initialAccountId);
  const [resourceId, setResourceId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  useGuardedDialogDirty(dirty);
  const [state, action, pending] = useActionState(importContactWorksheetAction, { error: null });
  const retainingCall = useContext(NavigationActivityContext);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const read = async () => {
      const mine = ++generation;
      setLoading(true);
      try {
        const result = await contactImportSourcesAction(organizationId);
        if (active && mine === generation) { setSources(result.sources); setError(result.error); }
      } catch { if (active && mine === generation) setError('Import sources are unavailable.'); }
      finally { if (active && mine === generation) setLoading(false); }
    };
    void read();
    window.addEventListener('focus', read);
    return () => { active = false; window.removeEventListener('focus', read); };
  }, [organizationId, revision]);
  const account = sources?.accounts.find(account => account.id === accountId) ?? sources?.accounts.find(account => account.status === 'active') ?? sources?.accounts[0];
  const worksheets = sources?.worksheets.filter(sheet => sheet.accountId === account?.id) ?? [];
  const sheet = worksheets.find(sheet => sheet.id === resourceId) ?? worksheets[0];
  const connectHref = (key: string, id?: string) => `/organizations/${organizationId}/settings/connections/connect/${key}?${new URLSearchParams({ intent: 'contact-import', ...(id ? { connection: id } : {}) })}`;
  const connectTarget = retainingCall ? '_blank' : undefined;
  return <div className="space-y-4">
    <ImportSteps organizationId={organizationId} current={0} />
    {oauthError ? <ErrorText role="alert">{oauthError}</ErrorText> : null}
    {error ? <div className="space-y-2"><ErrorText role="alert">{error}</ErrorText><Button tone="secondary" size="small" onClick={() => setRevision(value => value + 1)} disabled={loading}>Try again</Button></div> : null}
    {loading ? <p role="status" className="text-sm text-muted">Loading sources…</p> : null}
    {sources ? <>
      <label className="block text-sm">Source<SelectField value={mode} onValueChange={setMode} className="mt-1 w-full" options={[
        { value: 'worksheet', label: 'Google Sheets or Microsoft Excel' }, { value: 'upload', label: 'Upload a CSV' },
        { value: 'saved', label: 'Saved source' }, { value: 'library', label: 'Library CSV file' },
      ]} /></label>
      {mode === 'upload' ? <UploadSourceForm organizationId={organizationId} /> : null}
      {mode === 'saved' ? sources.saved.length ? <ul className="divide-y divide-border">{sources.saved.map(source => <li key={source.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{source.name}</span><ButtonLink tone="secondary" size="small" href={libraryNewImportHref(organizationId, source.id)}>Use</ButtonLink></li>)}</ul> : <p className="text-sm text-muted">No saved sources.</p> : null}
      {mode === 'library' ? sources.files.length ? <ul className="divide-y divide-border">{sources.files.map(file => <li key={file.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{file.name}</span><form action={selectLibraryFileAction}><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="documentId" value={file.id} /><Button type="submit" tone="secondary" size="small">Use</Button></form></li>)}</ul> : <p className="text-sm text-muted">No CSV files in Library.</p> : null}
      {mode === 'worksheet' ? <>
        {sources.accounts.length ? <label className="block text-sm">Account<SelectField value={account?.id ?? ''} onValueChange={value => { setAccountId(value); setResourceId(''); }} className="mt-1 w-full" options={sources.accounts.map(account => ({ value: account.id, label: `${account.label} · ${account.status === 'active' ? 'Connected' : account.status.replaceAll('_', ' ')}` }))} /></label> : <p className="text-sm text-muted">Connect an account to choose a spreadsheet.</p>}
        {account && account.status !== 'active' ? <p role="status" className="text-sm">This account is {account.status.replaceAll('_', ' ')}.</p> : null}
        {account ? <Button tone="secondary" size="small" disabled={refreshing || pending} onClick={() => startRefresh(async () => {
          try {
            const result = await refreshContactImportAccountAction(organizationId, account.id);
            setSources(result.sources);
            setError(result.error);
          } catch { setError('The account could not be refreshed.'); }
        })}>{refreshing ? 'Refreshing…' : 'Refresh spreadsheets'}</Button> : null}
        {account?.status === 'active' ? worksheets.length ? <form action={action} onChange={() => setDirty(true)} className="space-y-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="block text-sm">Spreadsheet<SelectField name="resourceId" value={sheet?.id ?? ''} onValueChange={setResourceId} className="mt-1 w-full" options={worksheets.map(sheet => ({ value: sheet.id, label: sheet.name }))} /></label>
          <div key={sheet?.id} className="space-y-4">
            {sheet?.type === 'microsoft_workbook' ? <label className="block text-sm">Worksheet<TextInput name="worksheet" required className="mt-1 w-full" placeholder="Contacts" /></label> : null}
            <label className="block text-sm">Range<TextInput name="range" required className="mt-1 w-full" placeholder={sheet?.type === 'google_sheet' ? 'Contacts!A1:Z501' : 'A1:Z501'} /></label>
            <label className="block text-sm">Stable ID column<TextInput name="key_column" type="number" min={0} max={100} required className="mt-1 w-full" aria-describedby="import-key-help" /></label>
            <p id="import-key-help" className="text-xs text-muted">Columns start at 0. Include the header row and up to 500 contact rows, each with its own ID.</p>
          </div>
          <Button type="submit" disabled={pending}>{pending ? 'Reading worksheet…' : 'Continue to mapping'}</Button>
          <ErrorText role="alert">{state.error}</ErrorText>
        </form> : <p className="text-sm text-muted">No spreadsheets are available from this account.</p> : null}
        <ul aria-label="Connect an account" className="divide-y divide-border">{sources.providers.map(provider => <li key={provider.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <span className="flex items-center gap-2"><ConnectorIcon variant="symbol" connector={{ key: provider.key, name: provider.name }} logoUrl={null} size="small" />{provider.name}</span>
          {provider.connectable ? <ButtonLink tone="secondary" size="small" prefetch={false} href={connectHref(provider.key, account?.connector === provider.key && account.status !== 'active' ? account.id : undefined)} target={connectTarget} rel={connectTarget ? 'noopener noreferrer' : undefined} aria-label={`Connect ${provider.name}${connectTarget ? ' (opens in a new tab)' : ''}`}>Connect</ButtonLink> : <span className="text-muted">Not available yet</span>}
        </li>)}</ul>
      </> : null}
    </> : null}
  </div>;
}
