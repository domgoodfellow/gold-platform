"use client"

import * as React from "react"
import { Group, Panel, Separator, type PanelSize } from "react-resizable-panels"
import { cn } from "cn"

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  )
}

const ResizablePanel = Panel

function ResizableHandle({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border outline-none data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-2 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0 hover:bg-ring/60 data-[resize-handle-active]:bg-ring",
        className
      )}
      {...props}
    />
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle, type PanelSize }
