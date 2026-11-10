'use client';

import { useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CircleAlert, ExternalLink, Plug, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Button, ButtonLink } from '@/components/controls/button';
import { GroupHeading } from '@/components/surfaces/section';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { FOCUS_RING, cx } from '@/components/class-names';
import { connectionAccountGroups, type HeaderConnectionAccount, type HeaderConnections } from '@/lib/application/shell/connection-menu-model';
import { ConnectorIcon } from '../catalogue/connector-icon';
import { headerConnectionsAction } from '@/app/organizations/[organizationId]/settings/connections/actions';

const STATUS: Record<HeaderConnectionAccount['status'], string> = {
  active: 'Connected', connecting: 'Connecting', needs_attention: 'Needs attention', disconnected: 'Disconnected',
};

export function HeaderConnectionsControl({ organizationId, initial, workspace }: {
  organizationId: string;
  initial: HeaderConnections;
  workspace?: { key: string; label: string };
}) {
  const [open, setOpen] = useState(false);
  const [refreshed, setRefreshed] = useState<HeaderConnections | null | undefined>(undefined);
  const [pending, start] = useTransition();
  const generation = useRef(0);
  const retainingCall = useContext(NavigationActivityContext);
  const router = useRouter();
  const model = refreshed === undefined ? initial : refreshed;
  const groups = connectionAccountGroups(model?.accounts ?? [], workspace?.key);
  const accounts = [...groups.relevant, ...groups.other];
  const attention = accounts.filter(account => account.status === 'needs_attention').length;
  const unavailable = model?.state === 'unavailable';
  const warning = unavailable || attention > 0;
  const marks = accounts.filter(account => account.status !== 'disconnected').filter((account, index, all) => all.findIndex(candidate => candidate.connectorKey === account.connectorKey) === index).slice(0, 3);
  const name = model === null ? 'Connect. Access changed.' : unavailable ? 'Connect. Connection status unavailable.' : attention ? `Connect. ${attention} ${attention === 1 ? 'account needs' : 'accounts need'} attention.` : 'Connect';

  const refresh = useCallback((includeReadiness = true) => {
    const mine = ++generation.current;
    start(async () => {
      try {
        const result = await headerConnectionsAction(organizationId, includeReadiness);
        if (generation.current === mine) setRefreshed(result);
      } catch {
        if (generation.current === mine) setRefreshed({ state: 'unavailable', accounts: [], manageHref: initial.manageHref });
      }
    });
  }, [organizationId, initial.manageHref]);
  useEffect(() => {
    const requests = generation;
    // An OAuth window can finish while the original call stays open. Read stored health on return.
    const onFocus = () => refresh(false);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); requests.current++; };
  }, [refresh]);
  const changeOpen = (next: boolean) => { setOpen(next); if (next) refresh(); };
  const close = () => setOpen(false);
  const browse = new URLSearchParams({ catalog: 'open', ...(workspace ? { workspace: workspace.key } : {}) });

  const rows = (items: HeaderConnectionAccount[]) => <ul className="divide-y divide-border">{items.map(account => <li key={account.id} className="flex items-center gap-3 py-3">
    <span className="shrink-0" aria-hidden><ConnectorIcon variant="symbol" connector={{ key: account.connectorKey, name: account.connectorName }} logoUrl={account.logoUrl} /></span>
    <div className="min-w-0 flex-1">
      <Link href={account.manageHref} onClick={close} className={cx('block rounded text-sm font-medium hover:underline', FOCUS_RING)}><span className="block truncate">{account.accountLabel}</span><span className="block truncate text-xs font-normal text-muted">{account.connectorName}</span></Link>
      <span className={cx('mt-1 flex items-center gap-1 text-xs', account.status === 'needs_attention' ? 'text-warning' : 'text-muted')}>{account.status === 'needs_attention' ? <CircleAlert aria-hidden className="size-3.5" /> : null}{STATUS[account.status]}</span>
    </div>
    {account.reconnectHref ? <ButtonLink tone="secondary" size="small" href={account.reconnectHref} prefetch={false} onClick={close} target={retainingCall && account.reconnectsExternally ? '_blank' : undefined} rel={retainingCall && account.reconnectsExternally ? 'noopener noreferrer' : undefined} aria-label={`Reconnect ${account.accountLabel}${retainingCall && account.reconnectsExternally ? ' (opens in a new tab)' : ''}`}><RefreshCw aria-hidden />Reconnect{retainingCall && account.reconnectsExternally ? <ExternalLink aria-hidden /> : null}</ButtonLink> : null}
  </li>)}</ul>;

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button type="button" tone="secondary" aria-label={name} className="relative h-9 gap-2 px-2 max-md:h-11 max-md:min-w-11">
        {marks.length ? <span aria-hidden className="flex -space-x-2">{marks.map((account, index) => <span key={account.connectorKey} className={cx('flex size-7 items-center justify-center rounded-full border border-border bg-surface ring-2 ring-background', index > 1 && 'hidden sm:flex')}><ConnectorIcon variant="symbol" connector={{ key: account.connectorKey, name: account.connectorName }} logoUrl={account.logoUrl} size="small" /></span>)}</span> : <Plug aria-hidden className="size-5" />}
        <span className="hidden lg:inline">Connect</span>
        {warning ? <span aria-hidden data-connection-warning className="absolute -right-1 -top-1 size-2.5 rounded-full bg-warning ring-2 ring-background" /> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex max-h-[calc(100dvh-6rem)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden p-0" aria-label="Connections">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Connections</h2>{pending ? <span role="status" className="text-xs text-muted">Updating…</span> : null}</div>
      <div className="min-h-0 overflow-y-auto px-4" aria-busy={pending}>
        {model === null ? <div role="status" className="py-4 text-sm"><p>Your access to Connections has changed.</p><Button tone="text" onClick={() => { close(); router.refresh(); }}>Refresh page</Button></div>
          : unavailable ? <div role="status" className="space-y-3 py-4 text-sm"><p>Connection status is unavailable.</p><Button tone="secondary" size="small" onClick={() => refresh()} disabled={pending}>Try again</Button></div>
            : !accounts.length ? <p className="py-4 text-sm text-muted">No connected accounts.</p>
              : <>{groups.relevant.length ? <section className="pt-3"><GroupHeading>Relevant to {workspace?.label}</GroupHeading>{rows(groups.relevant)}</section> : null}{groups.other.length ? <section className="pt-3">{workspace ? <GroupHeading>Other accounts</GroupHeading> : null}{rows(groups.other)}</section> : null}</>}
      </div>
      {model ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3"><ButtonLink tone="secondary" size="small" href={`${model.manageHref}?${browse}#app-library`} onClick={close}>Browse apps</ButtonLink><ButtonLink tone="text" size="small" href={model.manageHref} onClick={close}>Manage connections</ButtonLink></div> : null}
    </PopoverContent>
  </Popover>;
}
