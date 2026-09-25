import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectionView } from '@/components/containers/collection-view';
import { ViewModeSwitcher } from '@/components/controls/view-mode-switcher';
import { SettingsGrid, SettingsIndex, SettingsList } from '@/features/settings/settings-index';
import { SETTINGS_SECTIONS } from '@/features/settings/settings-map';

const ORG = '22222222-2222-4222-8222-222222222222';
const props = { organizationId: ORG, sections: SETTINGS_SECTIONS };
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const entryCount = SETTINGS_SECTIONS.flatMap((section) => section.entries).length;

describe('the presentation switcher', () => {
  const html = render(
    createElement(ViewModeSwitcher, { supported: ['list', 'grid'], value: 'grid', onChange: () => {}, label: 'Settings layout' }),
  );

  it('is a labelled group of toggle buttons, not tabs and not links', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Settings layout"');
    expect(html).not.toContain('role="tab');
    expect(html).not.toContain('<a ');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });

  it('says which presentation is showing with aria-pressed, and names each one in text', () => {
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(html).toContain('List');
    expect(html).toContain('Grid');
  });
});

describe('CollectionView', () => {
  it('draws the default presentation on the server, so hydration has nothing to disagree with', () => {
    const html = render(
      createElement(CollectionView, {
        storageKey: 'test.collection',
        defaultPresentation: 'list',
        renderings: { list: createElement('p', null, 'as a list'), grid: createElement('p', null, 'as a grid') },
      }),
    );
    expect(html).toContain('as a list');
    expect(html).not.toContain('as a grid');
  });

  it('offers no switcher for a surface that supports one presentation', () => {
    const html = render(
      createElement(CollectionView, {
        storageKey: 'test.single',
        defaultPresentation: 'table',
        renderings: { table: createElement('p', null, 'only a table') },
      }),
    );
    expect(html).toContain('only a table');
    expect(html).not.toContain('role="group"');
  });

  it('offers exactly the presentations the page supplied', () => {
    const html = render(
      createElement(CollectionView, {
        storageKey: 'test.two',
        defaultPresentation: 'list',
        renderings: { list: createElement('p', null, 'a'), grid: createElement('p', null, 'b') },
      }),
    );
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toContain('Table');
  });
});

describe('Settings in both presentations', () => {
  for (const [name, Presentation] of [
    ['list', SettingsList],
    ['grid', SettingsGrid],
  ] as const) {
    const html = render(createElement(Presentation, props));

    it(`${name}: keeps every group, in order, under its own heading`, () => {
      const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1].replaceAll('&amp;', '&'));
      expect(headings).toEqual(SETTINGS_SECTIONS.map((section) => section.title));
    });

    it(`${name}: gives each destination one link and no other control`, () => {
      expect(html.match(/<a /g)).toHaveLength(entryCount);
      expect(html).not.toContain('<button');
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it(`${name}: shows each destination's title and description`, () => {
      for (const entry of SETTINGS_SECTIONS.flatMap((section) => section.entries)) {
        expect(html, entry.key).toContain(entry.description);
      }
    });
  }

  it('the grid is tiles and the list is a divided list', () => {
    expect(render(createElement(SettingsGrid, props))).toContain('grid');
    expect(render(createElement(SettingsList, props))).toContain('divide-y');
  });

  it('the page body opens on the list with the switcher beside it', () => {
    const html = render(createElement(SettingsIndex, props));
    expect(html).toContain('divide-y');
    expect(html).toContain('aria-label="Settings layout"');
  });
});
