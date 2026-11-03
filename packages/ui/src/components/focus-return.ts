"use client"

/**
 * Returning focus to a popup's trigger without faking keyboard focus. A Radix popup moves focus by
 * script, and Chrome shows `:focus-visible` on any script focus, so a choice made with the mouse
 * would otherwise leave the keyboard outline on the trigger. When the last input was a pointer, the
 * trigger is focused with `focusVisible: false`; after a key press the primitive's own (visible)
 * focus return stands. Browsers without the option simply show the outline, as before.
 */
let lastInputWasPointer = false

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { lastInputWasPointer = true }, true)
  window.addEventListener('keydown', () => { lastInputWasPointer = false }, true)
}

export function returnFocusAfterPointer(event: Event, trigger: HTMLElement | null | undefined) {
  if (!lastInputWasPointer || !trigger || event.defaultPrevented) return
  event.preventDefault()
  // Focus that is already there keeps the state it arrived with, so it is released first.
  if (document.activeElement === trigger) trigger.blur()
  trigger.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
}
