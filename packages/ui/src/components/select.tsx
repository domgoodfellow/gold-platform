"use client"

import * as React from "react"
import { cn } from "cn"
import { Select as SelectPrimitive } from "radix-ui"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { useVisualPortalContainer } from './visual-scope'

/**
 * The trigger every single-value choice shares — styled Select and searchable Combobox alike — so the
 * two read as one control. The same box as Input; focus is the platform's one outline
 * (globals.css), never a ring drawn here.
 */
const selectTriggerClass =
  "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-left text-sm whitespace-nowrap transition-colors select-none hover:bg-hover disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-hover [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/** The popup every single-value choice shares; the same geometry as DropdownMenuContent. */
const selectContentClass =
  "relative z-50 min-w-32 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"

/** A choice in either popup: highlighted by keyboard or pointer, chosen with a check. */
const selectItemClass =
  "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-hover data-highlighted:text-foreground data-[state=checked]:font-medium aria-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" className={cn(selectTriggerClass, className)} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, children, position = "popper", sideOffset = 4, align = "start", density = 'default', ...props }: React.ComponentProps<typeof SelectPrimitive.Content> & { density?: 'default' | 'comfortable' }) {
  const container = useVisualPortalContainer();
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-density={density}
        position={position}
        sideOffset={position === "popper" ? sideOffset : undefined}
        align={position === "popper" ? align : undefined}
        className={cn(
          selectContentClass,
          // At least as wide as its trigger, and wide enough that a choice never wraps, within the screen.
          position === "popper" && "max-h-(--radix-select-content-available-height) w-max min-w-(--radix-select-trigger-width) max-w-[min(32rem,calc(100vw-1rem))]",
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "max-h-[min(20rem,var(--radix-select-content-available-height))] w-full scroll-my-1")}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn("px-2 py-1 text-xs font-medium text-muted-foreground", className)} {...props} />
}

function SelectItem({ className, children, description, ...props }: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item data-slot="select-item" data-value={props.value} {...props} className={cn(selectItemClass, description && "items-start", className)}>
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description ? <span className="block text-xs font-normal text-muted-foreground">{description}</span> : null}
      </span>
      <span data-slot="select-item-indicator" className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton data-slot="select-scroll-up-button" className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)} {...props}>
      <ChevronUpIcon aria-hidden className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton data-slot="select-scroll-down-button" className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)} {...props}>
      <ChevronDownIcon aria-hidden className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectContentClass,
  selectItemClass,
  selectTriggerClass,
}
