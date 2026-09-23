/**
 * One marker's DOM element — MapLibre positions a plain `HTMLElement`, not a React tree, so this
 * stays vanilla rather than mounting a second React root inside the map canvas. One neutral GOLD
 * marker treatment, selected or not: nothing here reads what a location is called, who it serves,
 * or anything else that would make a marker's colour a second, wordless status field (I6's
 * reasoning about colour, on this surface).
 */

const BASE_CLASS =
  'flex size-6 items-center justify-center rounded-full border-2 border-background bg-foreground text-background shadow-md transition-transform';
const SELECTED_CLASS = 'scale-125 ring-2 ring-accent ring-offset-2 ring-offset-background';

export function createLocationMarkerElement(input: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', input.label);
  button.className = BASE_CLASS;
  if (input.selected) button.className = `${BASE_CLASS} ${SELECTED_CLASS}`;
  button.innerHTML = '<span class="size-2 rounded-full bg-background" aria-hidden="true"></span>';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    input.onSelect();
  });
  return button;
}

export function setLocationMarkerSelected(element: HTMLElement, selected: boolean): void {
  element.className = selected ? `${BASE_CLASS} ${SELECTED_CLASS}` : BASE_CLASS;
}
