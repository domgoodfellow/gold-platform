'use client';

import { useState } from 'react';
import type { FormPublication } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { DividedList } from '@/components/surfaces/section';
import { PublicForm } from '@/features/forms/public-form';
import { submitPortalFormAction } from '@/app/(public)/portal/[token]/actions';

/**
 * The forms a business offers its customers in the portal. Each opens in place and is the same
 * `PublicForm` every other surface uses; this only says where its answers go. Which customer a
 * response is about is not asked of the form: the portal link already said.
 */
export function PortalForms({ forms, token }: { forms: FormPublication[]; token: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <DividedList className="mt-2">
      {forms.map((form) => {
        const open = openId === form.formId;
        return (
          <li key={form.formId} className="py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{form.definition.title}</span>
              <Button
                tone="secondary"
                size="small"
                aria-expanded={open}
                aria-controls={`portal-form-${form.formId}`}
                onClick={() => setOpenId(open ? null : form.formId)}
              >
                {open ? 'Close' : 'Open'}
              </Button>
            </div>
            {open ? (
              <div id={`portal-form-${form.formId}`} className="mt-4 rounded-lg border border-border p-4">
                <PublicForm
                  definition={form.definition}
                  revisionId={form.revisionId}
                  submit={({ answers }) => submitPortalFormAction({ token, formId: form.formId, answers })}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </DividedList>
  );
}
