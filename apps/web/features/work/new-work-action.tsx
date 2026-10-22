import { Plus } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';

export function newWorkHref(organizationId: string, typeId?: string) {
  const base = `/organizations/${organizationId}/work/new`;
  return typeId ? `${base}?${new URLSearchParams({ type: typeId })}` : base;
}

/** One creation destination and toolbar control for both Work entry points. */
export function NewWorkAction({ organizationId, typeId }: { organizationId: string; typeId?: string }) {
  return <ButtonLink size="small" tone="primary" href={newWorkHref(organizationId, typeId)}><Plus aria-hidden />New work</ButtonLink>;
}
