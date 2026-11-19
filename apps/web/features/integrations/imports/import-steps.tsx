import { StepIndicator } from '@/components/display/step-indicator';
import { libraryNewImportHref, type ImportDestination } from '@/lib/route/library';

export const IMPORT_STEPS = ['Choose source', 'Map fields', 'Review changes', 'Apply', 'Results'] as const;

/**
 * Where a contact import stands across Library's three import pages. Completed steps link back:
 * Choose source always, Map fields once a saved source exists. Going back never discards anything —
 * the uploaded file is a saved Library source and each staged run stays listed under Imports.
 */
export function ImportSteps({ organizationId, current, resourceId, into = 'contacts' }: { organizationId: string; current: number; resourceId?: string | null; into?: ImportDestination }) {
  const steps = IMPORT_STEPS.map((label, index) => ({
    label,
    href: index === 0 ? libraryNewImportHref(organizationId, undefined, into) : index === 1 && resourceId ? libraryNewImportHref(organizationId, resourceId, into) : undefined,
  }));
  return <StepIndicator steps={steps} current={current} label="Import progress" className="mb-6" />;
}
