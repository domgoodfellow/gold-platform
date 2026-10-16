/**
 * The one look of a row of sibling views, written once so the Radix `Tabs` (which switch content in
 * place), a link-based view navigation (which switch route) and button-driven filters of one page
 * cannot drift apart. Not a client module on purpose: a server component imports these strings
 * directly.
 *
 * Every trigger carries `data-slot="tabs-trigger"` (and every list `tabs-list`), which is what the
 * personal Appearance rules in `globals.css` target, so corner shape, density and the selected
 * fill follow the chosen style wherever a row of views appears.
 */
export const tabsListClassName =
  "flex w-full max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border sm:w-fit"

export const tabsTriggerClassName =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-accent data-[state=active]:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[selected=true]:border-accent aria-[selected=true]:font-semibold aria-[selected=true]:text-foreground aria-[pressed=true]:border-accent aria-[pressed=true]:font-semibold aria-[pressed=true]:text-foreground"
