import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * One selection grammar (`docs/ui-system.md`, Selection controls): a single-value choice is the
 * styled `SelectField` (Radix Select, or the searchable Combobox for long lists), free text with
 * suggestions is `SuggestionField`, and actions or navigation are a DropdownMenu. The application
 * authors no native selection popup — no `<select>`, `<option>` or `<datalist>` element, no
 * `<input list>` — and the retired `NativeSelect`/`SelectInput` pathway stays gone. Read from the
 * syntax tree, not the text, so SQL, a Supabase `.select()` call, an HTML string a library renders
 * or a word in a comment is never mistaken for a control.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const UI = fileURLToPath(new URL('../../../../../packages/ui/src', import.meta.url));
const ROOTS = [`${WEB}/app`, `${WEB}/components`, `${WEB}/features`, `${WEB}/lib`, UI];

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...sourcesUnder(path)); }
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

type Finding = { file: string; line: number; what: string };

function findings(file: string): Finding[] {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  const at = (node: ts.Node, what: string) => found.push({ file: file.replace(/\\/g, '/'), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, what });
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (['select', 'option', 'optgroup', 'datalist'].includes(tag)) at(node, `<${tag}>`);
      if (['NativeSelect', 'NativeSelectOption', 'NativeSelectOptGroup', 'SelectInput'].includes(tag)) at(node, `<${tag}>`);
      if (tag === 'input' || tag === 'TextInput' || tag === 'Input') {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(sf) === 'list') at(attribute, `<${tag} list>`);
        }
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/native-select/.test(node.moduleSpecifier.text)) at(node, `import ${node.moduleSpecifier.text}`);
      const names = node.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) for (const name of names.elements) if (['SelectInput', 'NativeSelect'].includes(name.name.text)) at(name, `import ${name.name.text}`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createElement' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && ['select', 'datalist', 'option'].includes(node.arguments[0].text)) {
      at(node, `createElement('${node.arguments[0].text}')`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('selection controls', () => {
  it('authors no native selection popup anywhere in the application or the shared UI package', () => {
    const offenders = ROOTS.flatMap(sourcesUnder).flatMap(findings).map(({ file, line, what }) => `${file.slice(file.indexOf('/apps/') >= 0 ? file.indexOf('/apps/') : file.indexOf('/packages/'))}:${line} ${what}`);
    expect(offenders).toEqual([]);
  });

  it('is not fooled by SQL, data-client select calls, HTML strings or comments', () => {
    const probe = `${WEB}/tests/architecture/static/selection-controls.test.ts`;
    // This file itself names every forbidden tag in strings and comments, and must pass.
    expect(findings(probe)).toEqual([]);
    const sample = ts.createSourceFile('sample.tsx', "const q = sql`select id from t`; db.from('t').select('id'); const html = '<select><option>a</option></select>'; // <datalist>\nexport const A = () => <SelectField options={[]} />;", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let jsx = 0;
    const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) jsx++; ts.forEachChild(node, visit); };
    visit(sample);
    expect(jsx).toBe(1);
  });

  it('exports the styled Select and the searchable Combobox from the shared UI package, and no native select', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../packages/ui/package.json', import.meta.url)), 'utf8')) as { exports: Record<string, string> };
    expect(pkg.exports['./components/select']).toBe('./src/components/select.tsx');
    expect(pkg.exports['./components/combobox']).toBe('./src/components/combobox.tsx');
    expect(Object.keys(pkg.exports).some(key => key.includes('native-select'))).toBe(false);
    expect(readFileSync(`${UI}/components/select.tsx`, 'utf8')).toMatch(/useVisualPortalContainer/);
    expect(readFileSync(`${UI}/components/combobox.tsx`, 'utf8')).toMatch(/useVisualPortalContainer/);
  });

  it('keeps one focus indicator: no ring, offset gap or suppressed outline in the shared primitives and controls', () => {
    const files = [...sourcesUnder(`${UI}/components`), ...sourcesUnder(`${WEB}/components`), ...sourcesUnder(`${WEB}/features`), ...sourcesUnder(`${WEB}/app`)];
    const offenders = files.filter(file => /focus-visible:ring-(?!0\b)|focus:ring-|focus-visible:ring-offset|has-focus-visible:ring|has-\[:focus-visible\]:ring/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    const names = readFileSync(`${WEB}/components/class-names.ts`, 'utf8');
    expect(names).not.toMatch(/ring-offset/);
    expect(names).toMatch(/outline-\[color:var\(--focus-color\)\]/);
    const css = readFileSync(`${WEB}/app/globals.css`, 'utf8');
    expect(css).not.toMatch(/outline-offset: 3px/);
    // The colour is the page's own text colour wherever the page's roles are declared, never a brand role.
    expect(css.match(/--focus-color: var\(--foreground\);/g)?.length).toBeGreaterThanOrEqual(3);
    expect(css).not.toMatch(/--focus-color: var\(--(accent|brand)/);
  });
});
