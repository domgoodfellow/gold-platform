'use client';

import { useActionState, useState } from 'react';
import type { PublicHomepageSection, PublicHomepageSections } from '@gold/schemas';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { Card } from '@/components/containers/card';
import type { EditorRevision } from '@/lib/domain/public-site/public-site';
import { createDraftAction, publishRevisionAction, saveDraftAction, submitRevisionAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/settings/website/actions';

const INITIAL: WebsiteActionState = { error: null };

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const Control = multiline ? TextArea : TextInput;
  return <FieldLabel className="grid gap-1">{label}<Control value={value} rows={multiline ? 3 : undefined} onChange={(event) => onChange(event.target.value)} /></FieldLabel>;
}

function SectionEditor({ section, onChange }: { section: PublicHomepageSection; onChange: (section: PublicHomepageSection) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...section, [key]: value } as PublicHomepageSection);
  const common = 'rounded border border-border p-4';
  switch (section.kind) {
    case 'hero': return <fieldset className={common}><legend className="px-1 font-semibold">Hero</legend><div className="grid gap-3"><Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} /><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} /><Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} /><Field label="Primary action label" value={section.primaryCta.label} onChange={(v) => set('primaryCta', { ...section.primaryCta, label: v })} /><Field label="Primary action path" value={section.primaryCta.href} onChange={(v) => set('primaryCta', { ...section.primaryCta, href: v })} /><Field label="Secondary action label" value={section.secondaryCta.label} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, label: v })} /><Field label="Secondary action path" value={section.secondaryCta.href} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, href: v })} /></div></fieldset>;
    case 'problem': return <fieldset className={common}><legend className="px-1 font-semibold">Problem</legend><div className="grid gap-3"><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />{section.paragraphs.map((paragraph, index) => <Field key={index} label={`Paragraph ${index + 1}`} multiline value={paragraph} onChange={(v) => set('paragraphs', section.paragraphs.map((item, i) => i === index ? v : item))} />)}</div></fieldset>;
    case 'capabilities': return <fieldset className={common}><legend className="px-1 font-semibold">Products</legend><div className="grid gap-3"><Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} /><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} /><Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} />{section.items.map((item, index) => <div key={index} className="grid gap-2 border-l-2 border-border pl-3"><Field label={`Item ${index + 1} title`} value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} /><Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} /></div>)}</div></fieldset>;
    case 'process': return <fieldset className={common}><legend className="px-1 font-semibold">Process</legend><div className="grid gap-3"><Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} /><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />{section.items.map((item, index) => <div key={index} className="grid gap-2 border-l-2 border-border pl-3 sm:grid-cols-[5rem_1fr]"><Field label="Step" value={item.step} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, step: v } : entry))} /><Field label="Title" value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} /><div className="sm:col-span-2"><Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} /></div></div>)}</div></fieldset>;
    case 'trust': return <fieldset className={common}><legend className="px-1 font-semibold">Trust</legend><div className="grid gap-3"><Field label="Eyebrow" value={section.eyebrow} onChange={(v) => set('eyebrow', v)} /><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} />{section.items.map((item, index) => <div key={index} className="grid gap-2 border-l-2 border-border pl-3"><Field label={`Item ${index + 1} title`} value={item.title} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, title: v } : entry))} /><Field label="Body" multiline value={item.body} onChange={(v) => set('items', section.items.map((entry, i) => i === index ? { ...entry, body: v } : entry))} /></div>)}</div></fieldset>;
    case 'cta': return <fieldset className={common}><legend className="px-1 font-semibold">Closing action</legend><div className="grid gap-3"><Field label="Heading" value={section.heading} onChange={(v) => set('heading', v)} /><Field label="Body" multiline value={section.body} onChange={(v) => set('body', v)} /><Field label="Primary action label" value={section.primaryCta.label} onChange={(v) => set('primaryCta', { ...section.primaryCta, label: v })} /><Field label="Primary action path" value={section.primaryCta.href} onChange={(v) => set('primaryCta', { ...section.primaryCta, href: v })} /><Field label="Secondary action label" value={section.secondaryCta.label} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, label: v })} /><Field label="Secondary action path" value={section.secondaryCta.href} onChange={(v) => set('secondaryCta', { ...section.secondaryCta, href: v })} /></div></fieldset>;
    default: return section satisfies never;
  }
}

function Feedback({ state }: { state: WebsiteActionState }) {
  return state.error ? <ErrorText>{state.error}</ErrorText> : state.success ? <Hint>{state.success}</Hint> : null;
}

export function HomepageEditor({ organizationId, working, published }: { organizationId: string; working: EditorRevision | null; published: EditorRevision | null }) {
  const [sections, setSections] = useState<PublicHomepageSections>(working?.sections ?? [] as unknown as PublicHomepageSections);
  const [seoTitle, setSeoTitle] = useState(working?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(working?.seoDescription ?? '');
  const [saveState, saveAction, saving] = useActionState(saveDraftAction, INITIAL);
  const [createState, createAction, creating] = useActionState(createDraftAction, INITIAL);
  const [submitState, submitAction, submitting] = useActionState(submitRevisionAction, INITIAL);
  const [publishState, publishAction, publishing] = useActionState(publishRevisionAction, INITIAL);

  if (!working) return <form action={createAction} className="mt-5"><input type="hidden" name="organizationId" value={organizationId} /><Button disabled={creating}>{published ? 'Create draft from published page' : 'Create homepage draft'}</Button><Feedback state={createState} /></form>;

  const identity = <><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="revisionId" value={working.id} /></>;
  return <div className="mt-5 grid gap-5">
    <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Revision {working.number}</p><Hint>Status: {working.status === 'in_review' ? 'In review' : 'Draft'}</Hint></div><ButtonLink href={`/preview/${organizationId}/${working.id}`} target="_blank">Preview revision</ButtonLink></div></Card>
    {working.status === 'draft' ? <>
      <form action={saveAction} className="grid gap-5">
        {identity}<input type="hidden" name="sections" value={JSON.stringify(sections)} />
        <Field label="SEO title" value={seoTitle} onChange={setSeoTitle} />
        <Field label="SEO description" multiline value={seoDescription} onChange={setSeoDescription} />
        {sections.map((section, index) => <SectionEditor key={section.kind} section={section} onChange={(next) => setSections(sections.map((entry, i) => i === index ? next : entry) as PublicHomepageSections)} />)}
        <div><Button disabled={saving}>Save draft</Button><Feedback state={saveState} /></div>
      </form>
      <form action={submitAction}>{identity}<Button tone="secondary" disabled={submitting}>Send saved draft for review</Button><Feedback state={submitState} /></form>
    </> : <form action={publishAction}>{identity}<Hint className="mb-3">Review the preview before publishing. Publishing archives the previous revision and changes the public site.</Hint><Button disabled={publishing}>Publish revision</Button><Feedback state={publishState} /></form>}
  </div>;
}
