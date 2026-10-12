import { afterEach, describe, expect, it, vi } from 'vitest';
import { designProperties, resolveDesignSelection, VISUAL_PRESETS, type DesignSelection } from '@gold/ui/design-system';
import { isPublic } from '@/lib/route/access';

afterEach(() => vi.unstubAllEnvs());

describe('visual configuration admission and precedence', () => {
  it('retains legacy defaults when nothing is selected', () => {
    expect(designProperties({})).toEqual({});
    expect(resolveDesignSelection()).toEqual({});
  });
  it('personal explicit preferences win; absent fields inherit', () => {
    expect(resolveDesignSelection({ preset: 'layered', density: 'compact' }, { preset: undefined, density: 'comfortable', appearance: 'dark' })).toEqual({ preset: 'layered', density: 'comfortable', appearance: 'dark' });
  });
  it('never emits brand, status, CSS injection or unknown configuration values', () => {
    expect(designProperties({ preset: 'url(evil)', shape: '__proto__', density: 'calc(evil)', '--success': 'red' } as unknown as DesignSelection)).toEqual({});
    for (const preset of Object.keys(VISUAL_PRESETS) as (keyof typeof VISUAL_PRESETS)[]) {
      const properties = designProperties({ preset });
      expect(Object.keys(properties).some((key) => /success|danger|warning|accent-text|on-accent|font/.test(key))).toBe(false);
      expect(properties).toHaveProperty('--visual-radius');
    }
  });
  it('shape and density resolve independently of the preset', () => {
    expect(designProperties({ preset: 'expressive', shape: 'square', density: 'comfortable' })).toMatchObject({ '--visual-radius': '0.25rem', '--control-height': '2.75rem' });
  });
  it('admits only the exact gallery route in development and refuses it in production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isPublic('/dev/design-system')).toBe(true);
    expect(isPublic('/dev/design-system/other')).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isPublic('/dev/design-system')).toBe(false);
  });
});
