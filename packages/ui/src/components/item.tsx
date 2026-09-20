import * as React from "react"
import { cn } from "cn"
import { Slot } from "radix-ui"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-group"
      role="list"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function Item({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "outline" | "muted"
  size?: "default" | "sm"
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="item"
      data-variant={variant}
      data-size={size}
      role="listitem"
      className={cn(
        "group/item flex flex-wrap items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-sm transition-colors",
        "data-[size=sm]:px-2.5 data-[size=sm]:py-2",
        "data-[variant=outline]:border-border",
        "data-[variant=muted]:bg-secondary",
        className
      )}
      {...props}
    />
  )
}

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(
        "flex shrink-0 items-center justify-center self-start",
        "data-[variant=icon]:size-8 data-[variant=icon]:rounded-md data-[variant=icon]:bg-secondary data-[variant=icon]:text-muted-foreground [&_svg]:size-4",
        className
      )}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("truncate text-sm font-medium leading-snug", className)}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-description"
      className={cn("truncate text-sm text-muted", className)}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex shrink-0 items-center gap-2", className)}
      {...props}
    />
  )
}

function ItemSeparator({ className, ...props }: React.ComponentProps<"hr">) {
  return <hr data-slot="item-separator" className={cn("my-0 border-border", className)} {...props} />
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
}
