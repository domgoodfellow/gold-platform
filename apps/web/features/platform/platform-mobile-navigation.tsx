'use client';

import { Menu } from 'lucide-react';
import { FOCUS_RING, cx } from '@/components/class-names';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { PlatformNavigation } from './platform-navigation';

export function PlatformMobileNavigation() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" aria-label="Open platform navigation" className={cx(FOCUS_RING, 'flex size-9 items-center justify-center rounded-md hover:bg-black/5 md:hidden dark:hover:bg-white/10')}>
          <Menu aria-hidden size={19} />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[19rem] gap-0 p-0">
        <SheetHeader className="h-14 justify-center border-b border-border px-4 py-0">
          <SheetTitle>GOLD Platform</SheetTitle>
          <SheetDescription className="sr-only">Platform control-plane navigation</SheetDescription>
        </SheetHeader>
        <PlatformNavigation mobile />
      </SheetContent>
    </Sheet>
  );
}
