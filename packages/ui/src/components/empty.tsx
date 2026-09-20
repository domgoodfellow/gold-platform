import * as React from "react"
import { cn } from "cn"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  )
}

function EmptyMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & { variant?: "icon" | "default" }) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        "flex items-center justify-center",
        "data-[variant=icon]:mb-1 data-[variant=icon]:size-10 data-[variant=icon]:rounded-full data-[variant=icon]:bg-secondary data-[variant=icon]:text-muted-foreground [&_svg]:size-5",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn("flex w-full max-w-sm flex-col items-center gap-3", className)}
      {...props}
    />
  )
}

export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent }
