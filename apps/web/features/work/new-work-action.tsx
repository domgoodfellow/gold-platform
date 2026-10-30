import { Plus } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { withSetupContext } from '@/lib/route/setup-context';

export function newWorkHref(organizationId: string, typeId?: string, context: { returnTo?: 'quote'; setupStep?: string } = {}) {
  const base = `/organizations/${organizationId}/work/new`;
  const query = new URLSearchParams();
  if (typeId) query.set('type', typeId);
  if (context.returnTo) query.set('returnTo', context.returnTo);
  const href = query.size ? `${base}?${query}` : base;
  return context.setupStep ? withSetupContext(href, context.setupStep) : href;
}

/** One creation destination and toolbar control for both Work entry points. */
export function NewWorkAction({ organizationId, typeId, returnTo, setupStep }: { organizationId: string; typeId?: string; returnTo?: 'quote'; setupStep?: string }) {
  return <ButtonLink size="small" tone="primary" href={newWorkHref(organizationId, typeId, { returnTo, setupStep })}><Plus aria-hidden />New work</ButtonLink>;
}
