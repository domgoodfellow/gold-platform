"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react"
import { returnFocusAfterPointer } from './focus-return'
import { Input } from './input'
import { selectContentClass, selectItemClass, selectTriggerClass } from './select'
import { useVisualPortalContainer } from './visual-scope'

export type ComboboxOption = {
  value: string
  label: string
  disabled?: boolean
  /** Options sharing a group are listed together under its heading, in first-seen order. */
  group?: string
  description?: string
  /** Extra words that should find this option, such as a code or an alias. */
  keywords?: string
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function matching<T extends ComboboxOption>(options: readonly T[], query: string): T[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return [...options]
  return options.filter(option => {
    const text = fold(`${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`)
    return words.every(word => text.includes(word))
  })
}

function grouped<T extends ComboboxOption>(options: readonly T[]): { group?: string; options: T[] }[] {
  const out: { group?: string; options: T[] }[] = []
  for (const option of options) {
    const last = out[out.length - 1]
    const existing = option.group ? out.find(entry => entry.group === option.group) : last && !last.group ? last : undefined
    if (existing) existing.options.push(option)
    else out.push({ group: option.group, options: [option] })
  }
  return out
}

/** Moves the highlight among enabled options, from `current` by `step`, stopping at either end. */
function step<T extends ComboboxOption>(options: readonly T[], current: string | null, by: 1 | -1 | 'first' | 'last'): string | null {
  const enabled = options.filter(option => !option.disabled)
  if (!enabled.length) return null
  if (by === 'first') return enabled[0].value
  if (by === 'last') return enabled[enabled.length - 1].value
  const index = enabled.findIndex(option => option.value === current)
  if (index === -1) return (by === 1 ? enabled[0] : enabled[enabled.length - 1]).value
  return enabled[Math.min(enabled.length - 1, Math.max(0, index + by))].value
}

function OptionList<T extends ComboboxOption>({ id, label, options, value, active, onActive, onChoose, emptyText, optionId }: {
  id: string
  label?: string
  options: readonly T[]
  value?: string
  active: string | null
  onActive: (value: string) => void
  onChoose: (value: string) => void
  emptyText: React.ReactNode
  optionId: (value: string) => string
}) {
  React.useEffect(() => {
    if (active === null) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active, optionId])
  return (
    <>
      <div role="listbox" id={id} aria-label={label} data-slot="combobox-list" className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height,18rem)-3rem))] overflow-y-auto overscroll-contain p-1 empty:hidden">
        {grouped(options).map(({ group, options: members }, index) => {
          const items = members.map(option => {
            const chosen = option.value === value
            return (
              <div
                key={option.value}
                id={optionId(option.value)}
                role="option"
                aria-selected={chosen}
                aria-disabled={option.disabled || undefined}
                data-slot="combobox-item"
                data-value={option.value}
                data-highlighted={active === option.value ? '' : undefined}
                data-disabled={option.disabled ? '' : undefined}
                className={cn(selectItemClass, option.description && 'items-start')}
                // Keep focus in the search field; choosing happens on click.
                onMouseDown={event => event.preventDefault()}
                onPointerMove={() => { if (!option.disabled && active !== option.value) onActive(option.value) }}
                onClick={() => { if (!option.disabled) onChoose(option.value) }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? <span className="block text-xs font-normal text-muted-foreground">{option.description}</span> : null}
                </span>
                {chosen ? <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center"><CheckIcon aria-hidden /></span> : null}
              </div>
            )
          })
          if (!group) return <React.Fragment key={`ungrouped-${index}`}>{items}</React.Fragment>
          const headingId = `${id}-group-${index}`
          return (
            <div key={group} role="group" aria-labelledby={headingId}>
              <div id={headingId} role="presentation" className="px-2 py-1 text-xs font-medium text-muted-foreground">{group}</div>
              {items}
            </div>
          )
        })}
      </div>
      {options.length ? null : <div role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>}
    </>
  )
}

type ComboboxProps<T extends ComboboxOption> = Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type' | 'role'> & {
  options: readonly T[]
  value?: string
  onValueChange: (value: string) => void
  /** What the closed control reads when nothing is chosen. */
  placeholder?: string
  /** Names the search field and the list for assistive technology; defaults to the trigger's own label. */
  searchLabel?: string
  searchPlaceholder?: string
  emptyText?: React.ReactNode
  contentClassName?: string
}

/**
 * A closed, searchable single-value choice for collections too long to scan — contacts, members,
 * time zones, countries. The trigger is the same box as Select; opening it moves focus into a search
 * field that filters the list (accent- and case-insensitive, every word must match) and moves a
 * highlight with the arrow keys. Enter chooses, Escape closes, and focus returns to the trigger.
 * It never accepts text that is not one of its options — that is `ComboboxInput`.
 */
function Combobox<T extends ComboboxOption>({
  options, value, onValueChange, placeholder = 'Select…', searchLabel, searchPlaceholder = 'Search…', emptyText = 'No matches',
  className, contentClassName, disabled, onKeyDown, ref, ...props
}: ComboboxProps<T>) {
  const container = useVisualPortalContainer()
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const [label, setLabel] = React.useState(searchLabel ?? props['aria-label'])
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState<string | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listId = React.useId()
  const selected = options.find(option => option.value === value)
  const visible = React.useMemo(() => matching(options, query), [options, query])
  const optionId = React.useCallback((option: string) => `${listId}-option-${options.findIndex(entry => entry.value === option)}`, [listId, options])

  const openWith = (seed = '') => {
    // The search field and list take the trigger's own name, however it was given (a visible label included).
    const trigger = triggerRef.current
    const labelledBy = trigger?.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ')
    setLabel(searchLabel ?? props['aria-label'] ?? (labelledBy || trigger?.labels?.[0]?.textContent?.trim() || undefined))
    setQuery(seed)
    const candidates = matching(options, seed)
    setActive(!seed && selected && !selected.disabled ? selected.value : step(candidates, null, 'first'))
    setOpen(true)
  }
  const choose = (next: string) => {
    setOpen(false)
    if (next !== value) onValueChange(next)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={next => (next ? openWith() : setOpen(false))}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={node => {
            triggerRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          data-slot="combobox-trigger"
          data-placeholder={selected ? undefined : ''}
          disabled={disabled}
          className={cn(selectTriggerClass, className)}
          onKeyDown={event => {
            onKeyDown?.(event)
            if (event.defaultPrevented || open) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openWith() }
            else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); openWith(event.key) }
          }}
          {...props}
        >
          <span data-slot="select-value">{selected?.label ?? placeholder}</span>
          <ChevronsUpDownIcon aria-hidden className="size-4 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          data-slot="combobox-content"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(selectContentClass, "w-(--radix-popover-trigger-width) min-w-56 max-w-[min(32rem,calc(100vw-1rem))] outline-hidden", contentClassName)}
          onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={event => returnFocusAfterPointer(event, triggerRef.current)}
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              data-slot="combobox-search"
              data-focus-indicator="container"
              aria-label={label ? `Search ${label}` : 'Search'}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active !== null && visible.some(option => option.value === active) ? optionId(active) : undefined}
              placeholder={searchPlaceholder}
              value={query}
              onChange={event => { setQuery(event.target.value); setActive(step(matching(options, event.target.value), null, 'first')) }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActive(current => step(visible, current, 1)) }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => step(visible, current, -1)) }
                else if (event.key === 'PageDown' || (event.key === 'End' && event.ctrlKey)) { event.preventDefault(); setActive(step(visible, null, 'last')) }
                else if (event.key === 'PageUp' || (event.key === 'Home' && event.ctrlKey)) { event.preventDefault(); setActive(step(visible, null, 'first')) }
                else if (event.key === 'Enter') {
                  // Never submits the surrounding form from inside the popup.
                  event.preventDefault()
                  const chosen = visible.find(option => option.value === active && !option.disabled)
                  if (chosen) choose(chosen.value)
                } else if (event.key === 'Tab') setOpen(false)
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
          </div>
          <OptionList id={listId} label={label} options={visible} value={value} active={active} onActive={setActive} onChoose={choose} emptyText={emptyText} optionId={optionId} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

type ComboboxInputProps = Omit<React.ComponentProps<typeof Input>, 'role' | 'list'> & {
  /** Offered while typing; any other text stays valid. */
  suggestions: readonly string[]
  onValueChange?: (value: string) => void
  emptyText?: React.ReactNode
}

/**
 * A free-text field with styled suggestions — the replacement for `<datalist>`. It stays a real text
 * input (its own name, value, required and form reset), so text that matches no suggestion is kept
 * exactly as typed. The arrow keys move through matching suggestions and Enter takes one; Escape
 * closes the list without changing the text.
 */
function ComboboxInput({ suggestions, onValueChange, emptyText, className, onChange, onKeyDown, onBlur, onFocus, value, defaultValue, ref, ...props }: ComboboxInputProps) {
  const container = useVisualPortalContainer()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [text, setText] = React.useState(String(value ?? defaultValue ?? ''))
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState<string | null>(null)
  const listId = React.useId()
  const current = value === undefined ? text : String(value)
  const options = React.useMemo(() => suggestions.map(suggestion => ({ value: suggestion, label: suggestion })), [suggestions])
  const visible = React.useMemo(() => matching(options, current).filter(option => option.value !== current), [options, current])
  const optionId = React.useCallback((option: string) => `${listId}-option-${suggestions.indexOf(option)}`, [listId, suggestions])
  const shown = open && visible.length > 0

  React.useEffect(() => {
    // A form reset restores the input's own default; keep the filter in step with it.
    const form = inputRef.current?.form
    if (!form) return
    const reset = () => window.setTimeout(() => setText(inputRef.current?.value ?? ''))
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [])

  const take = (suggestion: string) => {
    const input = inputRef.current
    setOpen(false)
    if (!input) return
    if (value === undefined) {
      // The field is the browser's own: set its value as typing would, so form listeners hear it.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, suggestion)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setText(suggestion)
    onValueChange?.(suggestion)
  }

  return (
    <PopoverPrimitive.Root open={shown} onOpenChange={next => { if (!next) setOpen(false) }}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          ref={node => {
            inputRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? listId : undefined}
          aria-activedescendant={shown && active !== null ? optionId(active) : undefined}
          data-slot="input"
          className={className}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onFocus={event => { onFocus?.(event) }}
          onChange={event => {
            onChange?.(event)
            setText(event.target.value)
            onValueChange?.(event.target.value)
            setOpen(true)
            setActive(null)
          }}
          onKeyDown={event => {
            onKeyDown?.(event)
            if (event.defaultPrevented) return
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(current => step(visible, current, 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => step(visible, current, -1)) }
            else if (event.key === 'Escape' && shown) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
            else if (event.key === 'Enter' && shown && active !== null) { event.preventDefault(); take(active) }
          }}
          onBlur={event => { onBlur?.(event); setOpen(false) }}
          {...props}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal container={container}>
        <PopoverPrimitive.Content
          data-slot="combobox-content"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(selectContentClass, "w-(--radix-popover-trigger-width) max-w-[min(32rem,calc(100vw-1rem))] outline-hidden")}
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => { if (event.target === inputRef.current) event.preventDefault() }}
        >
          <OptionList id={listId} label={props['aria-label'] ? `${props['aria-label']} suggestions` : 'Suggestions'} options={visible} value={current} active={active} onActive={setActive} onChoose={take} emptyText={emptyText ?? 'No suggestions'} optionId={optionId} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { Combobox, ComboboxInput }
