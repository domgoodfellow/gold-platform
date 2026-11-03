'use client';

import type { ReactNode } from 'react';
import type { PublicLink, SectionKind, SectionOf, WebsiteSection } from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { SECTION_REGISTRY, sectionLabel } from '@/lib/domain/public-site/section-registry';
import type { FormOption } from './types';
import { SelectField } from '@/components/controls/select-field';

/**
 * How each kind of section is edited. `SECTION_EDITORS` is keyed by every registered kind, so a
 * kind with no editor is a type error. An editor can express only what the section's schema (and
 * the database behind it) would accept — no field here can say anything they would refuse.
 */

type EditorProps<K extends SectionKind> = {
  section: SectionOf<K>;
  onChange: (section: SectionOf<K>) => void;
  organizationId: string;
  forms: FormOption[];
};

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const Control = multiline ? TextArea : TextInput;
  return (
    <FieldLabel className="grid gap-1 text-sm">
      {label}
      <Control value={value} rows={multiline ? 3 : undefined} onChange={(event) => onChange(event.target.value)} />
    </FieldLabel>
  );
}

function LinkFields({ label, link, onChange, optional }: { label: string; link: PublicLink | undefined; onChange: (link: PublicLink | undefined) => void; optional?: boolean }) {
  const value = link ?? { label: '', href: '' };
  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <Field label="Label" value={value.label} onChange={(next) => onChange({ ...value, label: next })} />
      <Field label="Path or anchor" value={value.href} onChange={(next) => onChange({ ...value, href: next })} />
      <Hint className="text-xs">A path inside this website, like /contact, or an anchor like #more.</Hint>
      {optional && link ? <div><Button type="button" tone="text" size="small" onClick={() => onChange(undefined)}>Remove this action</Button></div> : null}
    </fieldset>
  );
}

/** A repeated list of items the section's schema bounds; add and remove are bounded the same way. */
function ItemList<T>({ label, items, min, max, blank, onChange, children }: {
  label: string; items: T[]; min: number; max: number; blank: () => T; onChange: (items: T[]) => void;
  children: (item: T, change: (item: T) => void, index: number) => ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <div key={index} className="grid gap-2 border-l-2 border-border pl-3">
          {children(item, (next) => onChange(items.map((entry, i) => (i === index ? next : entry))), index)}
          <div>
            <Button type="button" tone="text" size="small" disabled={items.length <= min} aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove {label.toLowerCase()}</Button>
          </div>
        </div>
      ))}
      <div>
        <Button type="button" tone="secondary" size="small" disabled={items.length >= max} onClick={() => onChange([...items, blank()])}>Add {label.toLowerCase()}</Button>
      </div>
    </div>
  );
}

function Title({ kind }: { kind: SectionKind }) {
  return <h3 className="font-semibold">{sectionLabel(kind)}</h3>;
}

function Hero({ section, onChange }: EditorProps<'hero'>) {
  const variants = SECTION_REGISTRY.hero.variants ?? [];
  return (
    <div className="grid gap-4">
      <Title kind="hero" />
      <FieldLabel className="grid gap-1 text-sm">
        Layout
        <SelectField value={section.variant} onValueChange={(next) => onChange({ ...section, variant: next as typeof section.variant })} options={[...variants.map((variant) => ({ value: variant.value, label: variant.label }))]} />
      </FieldLabel>
      <Field label="Eyebrow" value={section.eyebrow} onChange={(value) => onChange({ ...section, eyebrow: value })} />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <Field label="Body" multiline value={section.body} onChange={(value) => onChange({ ...section, body: value })} />
      <LinkFields label="Primary action" link={section.primaryCta} onChange={(link) => link && onChange({ ...section, primaryCta: link })} />
      {section.secondaryCta
        ? <LinkFields label="Secondary action" link={section.secondaryCta} optional onChange={(link) => onChange({ ...section, secondaryCta: link })} />
        : <div><Button type="button" tone="secondary" size="small" onClick={() => onChange({ ...section, secondaryCta: { label: 'Learn more', href: '#more' } })}>Add a secondary action</Button></div>}
    </div>
  );
}

function Problem({ section, onChange }: EditorProps<'problem'>) {
  return (
    <div className="grid gap-4">
      <Title kind="problem" />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <ItemList label="Paragraph" items={section.paragraphs} min={1} max={4} blank={() => ''} onChange={(paragraphs) => onChange({ ...section, paragraphs })}>
        {(paragraph, change, index) => <Field label={`Paragraph ${index + 1}`} multiline value={paragraph} onChange={change} />}
      </ItemList>
    </div>
  );
}

function Content({ section, onChange }: EditorProps<'content'>) {
  return (
    <div className="grid gap-4">
      <Title kind="content" />
      <Field label="Eyebrow" value={section.eyebrow} onChange={(value) => onChange({ ...section, eyebrow: value })} />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <ItemList label="Paragraph" items={section.paragraphs} min={1} max={6} blank={() => ''} onChange={(paragraphs) => onChange({ ...section, paragraphs })}>
        {(paragraph, change, index) => <Field label={`Paragraph ${index + 1}`} multiline value={paragraph} onChange={change} />}
      </ItemList>
    </div>
  );
}

function Capabilities({ section, onChange }: EditorProps<'capabilities'>) {
  return (
    <div className="grid gap-4">
      <Title kind="capabilities" />
      <Field label="Eyebrow" value={section.eyebrow} onChange={(value) => onChange({ ...section, eyebrow: value })} />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <Field label="Body" multiline value={section.body} onChange={(value) => onChange({ ...section, body: value })} />
      <ItemList label="Card" items={section.items} min={1} max={9} blank={() => ({ title: 'New card', body: 'A sentence about it.' })} onChange={(items) => onChange({ ...section, items })}>
        {(item, change, index) => (
          <>
            <Field label={`Card ${index + 1} title`} value={item.title} onChange={(value) => change({ ...item, title: value })} />
            <Field label={`Card ${index + 1} body`} multiline value={item.body} onChange={(value) => change({ ...item, body: value })} />
          </>
        )}
      </ItemList>
    </div>
  );
}

function Process({ section, onChange }: EditorProps<'process'>) {
  return (
    <div className="grid gap-4">
      <Title kind="process" />
      <Field label="Eyebrow" value={section.eyebrow} onChange={(value) => onChange({ ...section, eyebrow: value })} />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <ItemList label="Step" items={section.items} min={1} max={6} blank={() => ({ step: String(section.items.length + 1).padStart(2, '0'), title: 'New step', body: 'What happens.' })} onChange={(items) => onChange({ ...section, items })}>
        {(item, change, index) => (
          <>
            <Field label={`Step ${index + 1} number`} value={item.step} onChange={(value) => change({ ...item, step: value })} />
            <Field label={`Step ${index + 1} title`} value={item.title} onChange={(value) => change({ ...item, title: value })} />
            <Field label={`Step ${index + 1} body`} multiline value={item.body} onChange={(value) => change({ ...item, body: value })} />
          </>
        )}
      </ItemList>
    </div>
  );
}

function Trust({ section, onChange }: EditorProps<'trust'>) {
  return (
    <div className="grid gap-4">
      <Title kind="trust" />
      <Field label="Eyebrow" value={section.eyebrow} onChange={(value) => onChange({ ...section, eyebrow: value })} />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <ItemList label="Reason" items={section.items} min={1} max={6} blank={() => ({ title: 'New reason', body: 'Say it plainly.' })} onChange={(items) => onChange({ ...section, items })}>
        {(item, change, index) => (
          <>
            <Field label={`Reason ${index + 1} title`} value={item.title} onChange={(value) => change({ ...item, title: value })} />
            <Field label={`Reason ${index + 1} body`} multiline value={item.body} onChange={(value) => change({ ...item, body: value })} />
          </>
        )}
      </ItemList>
    </div>
  );
}

function Cta({ section, onChange }: EditorProps<'cta'>) {
  return (
    <div className="grid gap-4">
      <Title kind="cta" />
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <Field label="Body" multiline value={section.body} onChange={(value) => onChange({ ...section, body: value })} />
      <LinkFields label="Primary action" link={section.primaryCta} onChange={(link) => link && onChange({ ...section, primaryCta: link })} />
      {section.secondaryCta
        ? <LinkFields label="Secondary action" link={section.secondaryCta} optional onChange={(link) => onChange({ ...section, secondaryCta: link })} />
        : <div><Button type="button" tone="secondary" size="small" onClick={() => onChange({ ...section, secondaryCta: { label: 'Learn more', href: '#more' } })}>Add a secondary action</Button></div>}
    </div>
  );
}

function FormEditor({ section, onChange, organizationId, forms }: EditorProps<'form'>) {
  const chosen = forms.find((form) => form.id === section.formId);
  return (
    <div className="grid gap-4">
      <Title kind="form" />
      <FieldLabel className="grid gap-1 text-sm">
        Form
        <SelectField value={section.formId} onValueChange={(next) => onChange({ ...section, formId: next })} options={[...(chosen ? [] : [{ value: section.formId, label: 'A form that is no longer available' }]), ...forms.map((form) => ({ value: form.id, label: `${form.name}${form.published ? '' : ' (not published)'}` }))]} />
      </FieldLabel>
      {chosen && !chosen.published ? <Hint>This form is not published, so visitors will see nothing here until it is.</Hint> : null}
      <Field label="Heading" value={section.heading} onChange={(value) => onChange({ ...section, heading: value })} />
      <Field label="Introduction" multiline value={section.body} onChange={(value) => onChange({ ...section, body: value })} />
      <div>
        <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/studio/forms/${section.formId}`}>Edit form</ButtonLink>
        <Hint className="mt-2">The questions are edited in the form itself, not here.</Hint>
      </div>
    </div>
  );
}

export const SECTION_EDITORS: { [K in SectionKind]: (props: EditorProps<K>) => ReactNode } = {
  hero: Hero, problem: Problem, content: Content, capabilities: Capabilities, process: Process, trust: Trust, cta: Cta, form: FormEditor,
};

export function SectionEditor({ section, onChange, organizationId, forms }: {
  section: WebsiteSection; onChange: (section: WebsiteSection) => void; organizationId: string; forms: FormOption[];
}) {
  const Edit = SECTION_EDITORS[section.kind] as (props: EditorProps<SectionKind>) => ReactNode;
  return <>{Edit({ section: section as never, onChange: onChange as never, organizationId, forms })}</>;
}
