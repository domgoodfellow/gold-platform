'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Sidebar,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton } from '@gold/ui/components/sidebar';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { platformDestinationsFor,platformHref } from '@/lib/platform-navigation';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';

export function PlatformShell({organizationId,permissions,children}:{organizationId:string;permissions:PlatformCapability[];children:ReactNode}) {
  const pathname=usePathname();const destinations=platformDestinationsFor(new Set(permissions));
  return <WorkspaceShell agent={null} header={<WorkspaceHeader navigationTrigger="always" agentTrigger="none" context={<span className="text-sm font-medium">Platform Administration</span>} />} sidebar={<Sidebar mobileSide="right"><SidebarHeader className="border-b border-sidebar-border p-4 font-semibold">GildOps Platform</SidebarHeader><SidebarContent><nav aria-label="Platform Administration"><SidebarMenu>{destinations.map(item=>{const href=platformHref(organizationId,item.path);return <SidebarMenuItem key={item.key}><SidebarMenuButton asChild isActive={pathname===href}><Link href={href} aria-current={pathname===href?'page':undefined}>{item.label}</Link></SidebarMenuButton></SidebarMenuItem>;})}</SidebarMenu></nav></SidebarContent><SidebarFooter><SidebarMenuButton asChild><Link href={`/organizations/${organizationId}/home`}>Open GildOps business</Link></SidebarMenuButton><SidebarMenuButton asChild><Link href="/settings/account">Account</Link></SidebarMenuButton></SidebarFooter></Sidebar>}>{children}</WorkspaceShell>;
}
