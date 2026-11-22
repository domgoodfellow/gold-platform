/** How Finance names a recorded cost's kind and how it was allocated. */
export const COST_CATEGORY_LABEL: Record<string, string> = {
  resource_direct: 'Resource',
  infrastructure_attributable: 'Infrastructure for one business',
  infrastructure_shared: 'Shared infrastructure',
  manual_direct: 'Other direct cost',
};

export const ALLOCATION_QUALITY_LABEL: Record<string, string> = {
  direct: 'Direct',
  measured: 'Measured',
  estimated: 'Estimated',
  shared: 'Shared',
  unallocated: 'Unallocated',
};
