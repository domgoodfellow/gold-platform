'use client';

import type { PublicHomepageSection } from '@gold/schemas';
import { ButtonLink } from '@/components/controls/button';
import { FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import type { FormOption } from './website-editing';

/**
 * The field-heavy editing surface, moved off the page and into a pane of its own. It edits
 * exactly the six section shapes `PublicHomepageSectionsSchema` already supports (and page-level
 * SEO) — no field here can express anything the schema, and the domain layer behind it, would
 * refuse.
 */
function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const Control = multiline ? TextArea : TextInput;
  return (
    <FieldLabel className="grid gap-1 text-sm">
      {label}
      <Control value={value} rows={multiline ? 3 : undefined} onChange={(event) => onChange(event.target.value)} />
    </FieldLabel>
  );
}

export function PageInspector({ seoTitle, seoDescription, onSeoTitle, onSeoDescription }: {
  seoTitle: string;
  seoDescription: string;
  onSeoTitle: (value: string) => void;
  onSeoDescription: (value: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <h3 className="font-semibold">Page</h3>
      <Field label="SEO title" value={seoTitle} onChange={onSeoTitle} />
      <Field label="SEO description" multiline value={seoDescription} onChange={onSeoDescription} />
    </div>
  );
}

export function SectionInspector({ section, onChange, organizationId, forms }: { section: PublicHomepageSection; onChange: (section: PublicHomepageSection) => void; organizationId: string; forms: FormOption[] }) {
  const set = (key: string, value: unknown) => onChange({ ...section, [key]: value } as PublicHomepageSection);

  switch (section.kind) {
    case 'hero':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Hero</h3>
          <Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} />
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          <Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} />
          <Field label="Primary action label" value={section.primaryCta.label} onChange={(v) => set('primaryCta', { ...section.primaryCta, label: v })} />
          <Field label="Primary action path" value={section.primaryCta.href} onChange={(v) => set('primaryCta', { ...section.primaryCta, href: v })} />
          <Field label="Secondary action label" value={section.secondaryCta.label} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, label: v })} />
          <Field label="Secondary action path" value={section.secondaryCta.href} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, href: v })} />
        </div>
      );
    case 'problem':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Problem</h3>
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          {section.paragraphs.map((paragraph, index) => (
            <Field key={index} label={`Paragraph ${index + 1}`} multiline value={paragraph} onChange={(v) => set('paragraphs', section.paragraphs.map((item, i) => i === index ? v : item))} />
          ))}
        </div>
      );
    case 'capabilities':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Capabilities</h3>
          <Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} />
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          <Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} />
          {section.items.map((item, index) => (
            <div key={index} className="grid gap-2 border-l-2 border-border pl-3">
              <Field label={`Item ${index + 1} title`} value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} />
              <Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} />
            </div>
          ))}
        </div>
      );
    case 'process':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Process</h3>
          <Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} />
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          {section.items.map((item, index) => (
            <div key={index} className="grid gap-2 border-l-2 border-border pl-3">
              <Field label="Step" value={item.step} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, step: v } : entry))} />
              <Field label="Title" value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} />
              <Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} />
            </div>
          ))}
        </div>
      );
    case 'trust':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Trust</h3>
          <Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} />
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          {section.items.map((item, index) => (
            <div key={index} className="grid gap-2 border-l-2 border-border pl-3">
              <Field label={`Item ${index + 1} title`} value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} />
              <Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} />
            </div>
          ))}
        </div>
      );
    case 'cta':
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Closing action</h3>
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          <Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} />
          <Field label="Primary action label" value={section.primaryCta.label} onChange={(v) => set('primaryCta', { ...section.primaryCta, label: v })} />
          <Field label="Primary action path" value={section.primaryCta.href} onChange={(v) => set('primaryCta', { ...section.primaryCta, href: v })} />
          <Field label="Secondary action label" value={section.secondaryCta.label} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, label: v })} />
          <Field label="Secondary action path" value={section.secondaryCta.href} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, href: v })} />
        </div>
      );
    case 'form': {
      const chosen = forms.find((form) => form.id === section.formId);
      return (
        <div className="grid gap-4">
          <h3 className="font-semibold">Form</h3>
          <FieldLabel className="grid gap-1 text-sm">
            Form
            <SelectInput value={section.formId} onChange={(event) => set('formId', event.target.value)}>
              {chosen ? null : <option value={section.formId}>A form that is no longer available</option>}
              {forms.map((form) => <option key={form.id} value={form.id}>{form.name}{form.published ? '' : ' (not published)'}</option>)}
            </SelectInput>
          </FieldLabel>
          {chosen && !chosen.published ? <Hint>This form is not published, so visitors will see nothing here until it is.</Hint> : null}
          <Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />
          <Field label="Introduction" multiline value={section.body} onChange={(v) => set('body', v)} />
          <div>
            <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/studio/forms/${section.formId}`}>Edit form</ButtonLink>
            <Hint className="mt-2">The questions are edited in the form itself, not here.</Hint>
          </div>
        </div>
      );
    }
    default:
      return section satisfies never;
  }
}
