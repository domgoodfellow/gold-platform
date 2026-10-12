import type { CSSProperties } from 'react';

export type VisualPreset = 'minimal' | 'layered' | 'expressive';
export type Appearance = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable';
export type Shape = 'square' | 'rounded' | 'soft';
export type MotionPreference = 'system' | 'reduced';
export type SurfaceVariant = 'default' | 'quiet' | 'outlined' | 'elevated' | 'accent';

/** Closed, trusted values only. No tenant CSS, semantic status or brand overrides. */
export const VISUAL_PRESETS = {
  minimal: { label: 'Minimal', radius: '0.375rem', elevation: 'none', overlay: '0 4px 16px rgb(0 0 0 / .12)', duration: '100ms', feedback: '0%' },
  layered: { label: 'Layered', radius: '0.625rem', elevation: '0 2px 6px rgb(0 0 0 / .08), 0 12px 24px rgb(0 0 0 / .04)', overlay: '0 8px 32px rgb(0 0 0 / .18)', duration: '160ms', feedback: '4%' },
  expressive: { label: 'Expressive', radius: '1rem', elevation: '0 4px 12px rgb(0 0 0 / .10), 0 16px 32px rgb(0 0 0 / .06)', overlay: '0 12px 40px rgb(0 0 0 / .24)', duration: '220ms', feedback: '8%' },
} as const;

export type DesignSelection = {
  /** Absence retains the established appearance. */
  preset?: VisualPreset;
  density?: Density;
  shape?: Shape;
  motion?: MotionPreference;
};
export type PersonalAppearancePreferences = DesignSelection & { appearance?: Appearance };
/** Future organization-owned operational defaults; not brand_settings persistence. */
export type OrganizationDesignDefaults = DesignSelection;
/** Future Studio-owned, publication-snapshotted website design. Never shell configuration. */
export type StudioWebsiteDesignOverrides = DesignSelection & {
  appearance?: Exclude<Appearance, 'system'>;
  sections?: Readonly<Record<string, DesignSelection>>;
};

export function resolveDesignSelection(organization: OrganizationDesignDefaults = {}, personal: PersonalAppearancePreferences = {}): PersonalAppearancePreferences {
  return Object.fromEntries(Object.entries({ ...organization, ...Object.fromEntries(Object.entries(personal).filter(([, value]) => value !== undefined)) }));
}

/** Runtime admission protects callers that deserialize future configuration. */
export function designProperties(selection: DesignSelection): CSSProperties {
  const values: Record<string, string> = {};
  if (selection.preset && Object.hasOwn(VISUAL_PRESETS, selection.preset)) {
    const preset = VISUAL_PRESETS[selection.preset];
    Object.assign(values, {
      '--visual-radius': preset.radius, '--visual-elevation': preset.elevation,
      '--visual-overlay-shadow': preset.overlay, '--motion-fast': preset.duration,
      '--motion-normal': preset.duration, '--visual-accent-mix': preset.feedback,
    });
  }
  const shapes = { square: '0.25rem', rounded: '0.625rem', soft: '1rem' };
  if (selection.shape && Object.hasOwn(shapes, selection.shape)) values['--visual-radius'] = shapes[selection.shape];
  if (selection.density === 'compact' || selection.density === 'comfortable') {
    values['--control-height'] = selection.density === 'compact' ? '2rem' : '2.75rem';
    values['--visual-spacing'] = selection.density === 'compact' ? '0.75rem' : '1rem';
  }
  return values as CSSProperties;
}

export const surfaceVariants: Record<SurfaceVariant, string> = {
  default: '',
  quiet: 'bg-secondary ring-0 border-transparent shadow-none',
  outlined: 'bg-transparent border border-border ring-0 shadow-none',
  elevated: 'bg-surface shadow-[var(--visual-elevation)]',
  accent: 'border border-accent/30 bg-[var(--surface-accent)] ring-0',
};
