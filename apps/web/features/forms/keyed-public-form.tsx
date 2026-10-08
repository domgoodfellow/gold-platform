'use client';

import type { FormDefinition } from '@gold/schemas';
import { useRef } from 'react';
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
  const requestId = useRef<string | null>(null);
  return (
    <PublicForm
      definition={definition}
      revisionId={revisionId}
      showTitle={showTitle}
      submit={(input) => {
        requestId.current ??= crypto.randomUUID();
        const query = new URLSearchParams(window.location.search);
        const utm: Record<string, string> = {};
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
          const value = query.get(key);
          if (value) utm[key] = value;
        }
        const token = query.get('campaign_token') ?? undefined;
        return submitFormByKeyAction({ publicKey, source, ...input, attribution: token || Object.keys(utm).length ? { token, utm, requestId: requestId.current } : undefined });
      }}
    />
  );
}
