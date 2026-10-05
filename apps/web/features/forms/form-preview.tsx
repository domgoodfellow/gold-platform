'use client';

import { useState } from 'react';
import type { FormDefinition } from '@gold/schemas';
import { FormRenderer, type FormValues } from './form-renderer';

/** The shared renderer with nothing behind its button: for looking at a form, never answering it. */
export function FormPreview({ definition, showTitle }: { definition: FormDefinition; showTitle?: boolean }) {
  const [values, setValues] = useState<FormValues>({});
  return <FormRenderer definition={definition} values={values} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} showTitle={showTitle} />;
}
