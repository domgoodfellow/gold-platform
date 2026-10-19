'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@gold/ui/components/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { SidebarMenuButton } from '@gold/ui/components/sidebar';
import { Button } from '@/components/controls/button';
import { useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import type { HomeData } from '@/lib/application/home/contracts';
import { loadCommandData } from './command-actions';

const Commands = createContext<{ data: HomeData | null; publish: (data: HomeData) => void; openSearch: () => void; searchOpen: boolean; setSearchOpen: (open: boolean) => void; load: () => void; loading: boolean; error: boolean; displayName: string } | null>(null);
export function CommandCenterProvider({ organizationId, displayName, children }: { organizationId: string; displayName: string; children: ReactNode }) {
  const [data, publish] = useState<HomeData | null>(null);
  const [searchOpen, setSearchOpen] = useState(false), [loading, start] = useTransition(), [error, setError] = useState(false);
  const load = () => start(async () => { try { publish(await loadCommandData(organizationId)); setError(false); } catch { setError(true); } });
  const openSearch = () => { setSearchOpen(true); if (!data) load(); };
  return <Commands.Provider value={{ data, publish, openSearch, searchOpen, setSearchOpen, load, loading, error, displayName }}>{children}</Commands.Provider>;
}
export function useHomeCommands() { return useContext(Commands); }
/** The one Search control: the same command interface everywhere, drawn as a standard sidebar row. */
export function SearchEntry() {
  const commands = useHomeCommands();
  if (!commands) return null;
  return <SidebarMenuButton tooltip="Search" aria-label="Search" onClick={commands.openSearch}><Search aria-hidden /><span>Search</span></SidebarMenuButton>;
}
export function QuickActions({ actions }: { actions: HomeData['quickActions'] }) {
  const groups = groupActions(actions);
  return <DropdownMenu><DropdownMenuTrigger asChild><Button tone="secondary" size="small"><Plus aria-hidden className="size-4"/>Quick actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-[70svh] w-64 overflow-y-auto">{groups.map(([workspace, items]) => <div key={workspace}><DropdownMenuLabel>{workspace}</DropdownMenuLabel>{items.map(action => <DropdownMenuItem key={action.key} asChild><Link href={action.href}>{action.label}<ArrowRight aria-hidden className="ml-auto size-3"/></Link></DropdownMenuItem>)}</div>)}{!actions.length ? <p className="p-3 text-xs text-muted">No create actions available.</p> : null}</DropdownMenuContent></DropdownMenu>;
}
function groupActions(actions: HomeData['quickActions']) {
  const workspaces: Record<string, string> = { customer: 'CRM', work: 'Work', case: 'Support', campaign: 'Marketing', invoice: 'Finance', message: 'Communications', rule: 'Automations', form: 'Studio' };
  const groups = new Map<string, HomeData['quickActions']>();
  for (const action of actions) { const workspace = workspaces[action.key] ?? 'Other'; groups.set(workspace, [...(groups.get(workspace) ?? []), action]); }
  return [...groups];
}
export function CommandPalette() {
  const commands = useHomeCommands(), { launchAgent } = useWorkspaceRail();
  const [query, setQuery] = useState('');
  const results = useRef<HTMLDivElement>(null);
  const move = (event: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(results.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  };
  const needsData = !!commands?.searchOpen && !commands.data && !commands.loading && !commands.error;
  useEffect(() => { if (needsData) commands?.load(); }, [needsData, commands]);
  if (!commands) return null;
  const matches = (label: string) => label.toLowerCase().includes(query.toLowerCase());
  const actions = commands.data?.quickActions ?? [];
  const prompts = commands.data?.agentPrompts ?? [];
  const groups = groupActions(actions.filter(action => matches(action.label) || matches(`Create ${action.label.replace(/^New /, '')}...`)));
  const destinations = (commands.data?.search ?? []).filter(item => matches(item.label));
  const visiblePrompts = prompts.filter(matches);
  const close = () => { commands.setSearchOpen(false); setQuery(''); };
  return <Dialog open={commands.searchOpen} onOpenChange={open => { commands.setSearchOpen(open); if (!open) setQuery(''); }}><DialogContent className="flex! max-h-[80svh] flex-col gap-3 p-4"><DialogTitle>Search and commands</DialogTitle><DialogDescription className="sr-only">Find a workspace, create a record, or ask the Agent. Use Tab to choose a result.</DialogDescription><input aria-label="Search commands" autoFocus onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); results.current?.querySelector<HTMLElement>('a[href], button:not(:disabled)')?.focus(); } }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search, create, or ask..." className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"/><div ref={results} onKeyDown={move} className="min-h-0 overflow-y-auto">{commands.loading ? <p role="status" className="p-3 text-sm text-muted">Loading commands...</p> : null}{commands.error ? <Button tone="secondary" onClick={commands.load}>Retry loading commands</Button> : null}{groups.map(([workspace, items]) => <section key={workspace} className="mb-3"><h3 className="px-2 py-1 text-xs font-medium text-muted">{workspace}</h3>{items.map(action => <Link key={action.key} href={action.href} onClick={close} className="flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring">{action.label === 'Compose message' ? action.label : `Create ${action.label.replace(/^New /, '')}...`}<ArrowRight aria-hidden className="ml-auto size-3"/></Link>)}</section>)}{destinations.length ? <section><h3 className="px-2 py-1 text-xs font-medium text-muted">Go to</h3>{destinations.map(item => <Link key={item.href} href={item.href} onClick={close} className="flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring">{item.label}</Link>)}</section> : null}{visiblePrompts.length ? <section><h3 className="px-2 py-1 text-xs font-medium text-muted">Ask Agent</h3>{visiblePrompts.map(prompt => <Button key={prompt} tone="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" onClick={() => { close(); launchAgent(prompt); }}>{prompt}</Button>)}</section> : null}{!commands.loading && !commands.error && !groups.length && !destinations.length && !visiblePrompts.length ? <p className="p-3 text-sm text-muted">No matching commands.</p> : null}</div></DialogContent></Dialog>;
}
