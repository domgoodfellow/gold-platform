// @vitest-environment jsdom
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CurrencyField, TimeZoneField } from '@/features/locale/locale-fields';

afterEach(() => vi.restoreAllMocks());

it('hydrates differing ICU catalogues and retains a saved timezone absent from offered values', async () => {
  const values = vi.spyOn(Intl, 'supportedValuesOf');
  values.mockImplementation((key) => key === 'currency' ? ['EUR', 'ANG'] : ['Europe/Amsterdam']);
  const fields = <><TimeZoneField defaultValue="UTC" /><CurrencyField defaultValue="EUR" /></>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(fields);
  document.body.append(container);
  // The browser has a different CLDR snapshot from the server.
  values.mockImplementation((key) => key === 'currency' ? ['EUR', 'XCG'] : ['Europe/Amsterdam', 'Europe/Kyiv']);
  const recover = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, fields, { onRecoverableError: recover }); });
  expect(recover).not.toHaveBeenCalled();
  expect((container.querySelector('[name="timezone"]') as HTMLSelectElement).value).toBe('UTC');
  expect((container.querySelector('[name="currency"]') as HTMLSelectElement).value).toBe('EUR');
  await act(async () => root.unmount());
  container.remove();
});
