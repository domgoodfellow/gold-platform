'use client';

import { cx } from '@/components/class-names';
import {
  SHELL_HEADER_HEIGHT,
  SHELL_HEADER_STYLE,
  SidebarLabel,
  SidebarToggle,
  useSidebarCollapsed,
} from '@/components/containers/app-shell';

export function PlatformSidebarHeader() {
  const collapsed = useSidebarCollapsed();

  return (
    <div
      style={SHELL_HEADER_STYLE}
      className={cx(
        SHELL_HEADER_HEIGHT,
        'flex items-center gap-2 border-b border-border',
        collapsed ? 'justify-center px-0' : 'px-2 md:justify-center lg:justify-start',
      )}
    >
      <SidebarToggle />
      <SidebarLabel><span className="font-semibold">GOLD Platform</span></SidebarLabel>
    </div>
  );
}
