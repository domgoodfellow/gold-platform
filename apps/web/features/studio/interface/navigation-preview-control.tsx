'use client';

import { useTransition } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { setNavigationLayoutAction } from '@/app/organizations/[organizationId]/studio/interface/navigation/actions';

/**
 * Shown in the organization header while the unified navigation preview is on (ADR-056): it says
 * the sidebar is not the default one, and one press returns to it. Leaving needs no permission.
 */
export function NavigationPreviewControl({ organizationId }: { organizationId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      tone="secondary"
      size="small"
      className="shrink-0 gap-1"
      aria-label="Exit unified navigation preview"
      disabled={pending}
      onClick={() => start(async () => {
        const result = await setNavigationLayoutAction(organizationId, 'contextual');
        if (result.ok) toast.success('Current navigation restored');
        else toast.error(result.error);
      })}
    >
      <span className="md:hidden">Preview</span>
      <span className="max-md:hidden">Unified navigation</span>
      <X aria-hidden size={14} />
    </Button>
  );
}
