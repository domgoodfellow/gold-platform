'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MoreHorizontal, Phone } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Button, ButtonLink } from '@/components/controls/button';
import { claimAction, markReadAction } from '@/app/organizations/[organizationId]/comms/inbox/actions';
import type { InboxItem } from '@/lib/domain/reception/inbox';

export function NewCallButton({ organizationId, toNumber = '', compact = false }: { organizationId: string; toNumber?: string; compact?: boolean }) {
  // The Dialer is the one place to place a call; a number is carried across so it is already filled in.
  const href = `/organizations/${organizationId}/calls${toNumber ? `?to=${encodeURIComponent(toNumber)}` : ''}`;
  return <ButtonLink href={href} tone={compact ? 'secondary' : 'primary'} size="small"><Phone aria-hidden />{compact ? 'Call back' : 'New call'}</ButtonLink>;
}

export function ConversationActions({ organizationId, item }: { organizationId: string; item: InboxItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'read' | 'claim') => {
    setBusy(true); setError(null);
    try {
      const result = await (kind === 'read' ? markReadAction(organizationId, item.id) : claimAction(organizationId, item.id));
      if (!result.ok) setError(result.error); else router.refresh();
    } catch { setError('Could not update this conversation. Try again.'); }
    finally { setBusy(false); }
  };
  return <div><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`Actions for ${item.title}`} tone="text" size="tiny" disabled={busy}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/organizations/${organizationId}/comms/inbox/${item.id}`}>Open conversation</Link></DropdownMenuItem>{item.unread ? <DropdownMenuItem onSelect={() => void run('read')}>Mark read</DropdownMenuItem> : null}{!item.assignee ? <DropdownMenuItem onSelect={() => void run('claim')}>Assign to me</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu>{error ? <p role="alert" className="max-w-48 text-xs text-danger">{error}</p> : null}</div>;
}
