'use client';

import { createContext, useContext, useState, type ComponentProps } from 'react';
import { designProperties, type PersonalAppearancePreferences } from '../design-system';

const PortalContainer = createContext<HTMLElement | null>(null);
export function useVisualPortalContainer() { return useContext(PortalContainer); }

/** Opt-in boundary; portal children inherit the same tokens and forced color scheme. */
export function VisualScope({ selection, children, ...props }: Omit<ComponentProps<'div'>, 'style'> & { selection: PersonalAppearancePreferences }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const active = Boolean(selection.preset || selection.density || selection.shape || selection.motion);
  return <PortalContainer.Provider value={container}>
    <div {...props} ref={setContainer} data-visual-system={active ? '' : undefined}
      data-appearance={selection.appearance === 'light' || selection.appearance === 'dark' ? selection.appearance : undefined}
      data-visual-preset={selection.preset} data-density={selection.density} data-motion={selection.motion}
      style={designProperties(selection)}>{children}</div>
  </PortalContainer.Provider>;
}
