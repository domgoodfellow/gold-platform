/** Server-importable presentation shared by content tabs, route links and local filters. */
export type TabVariant = 'segmented' | 'line';

export const tabListStructure = 'flex w-fit max-w-full flex-wrap items-center gap-1';
export const tabListVariants: Record<TabVariant, string> = {
  segmented: 'rounded-[var(--visual-radius,0.625rem)] bg-secondary p-1',
  line: 'border-b border-border',
};

export function tabListStyles(variant: TabVariant = 'segmented') {
  return `${tabListStructure} ${tabListVariants[variant]}`;
}

export const tabTriggerStyles =
  'inline-flex min-h-[var(--control-height,2.25rem)] max-w-full items-center justify-center gap-1.5 whitespace-normal px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-semibold data-[state=active]:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[selected=true]:font-semibold aria-[selected=true]:text-foreground aria-[pressed=true]:font-semibold aria-[pressed=true]:text-foreground';
