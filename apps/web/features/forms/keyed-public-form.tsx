'use client';

import type { FormDefinition } from '@gold/schemas';
import { submitFormByKeyAction } from '@/app/(public)/forms/actions';
import { PublicForm } from './public-form';

/**
 * A published form that submits by its public key, from whichever public surface it is on. The
 * surface is the `source`: hosted page, website section or embed. Everything about the form itself
 * is the one `PublicForm`; this only says where its answers go.
 */
export function KeyedPublicForm({ definition, revisionId, publicKey, source, showTitle }: {
  definition: FormDefinition;
  revisionId: string;
  publicKey: string;
  source: 'hosted' | 'website' | 'embed';
  showTitle?: boolean;
}) {
  return (
    <PublicForm
      definition={definition}
      revisionId={revisionId}
      showTitle={showTitle}
      submit={(input) => submitFormByKeyAction({ publicKey, source, ...input })}
    />
  );
}
