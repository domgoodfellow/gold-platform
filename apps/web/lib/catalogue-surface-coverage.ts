export type DomainCoverage = 'none' | 'partial' | 'complete';
export type UiCoverage = 'none' | 'partial' | 'usable' | 'mature';
export type InteractionCoverage = 'none' | 'read-only' | 'configurable' | 'operational';
export type TestCoverage = 'none' | 'unit/domain' | 'integration' | 'E2E';

export type CatalogueSurfaceCoverage = {
  key: string;
  catalogueState: 'available' | 'partial';
  domain: DomainCoverage;
  ui: UiCoverage;
  interaction: InteractionCoverage;
  test: TestCoverage;
  evidence: readonly string[];
  gap: string | null;
};

/** Every non-planned row in the canonical seed, qualified to survive repeated feature names. */
const FEATURE_STATES = {
  'crm.customers_contacts.customer_profile': 'available',
  'crm.customers_contacts.ownership_assignment': 'available',
  'crm.customers_contacts.tags_segmentation': 'partial',
  'crm.customers_contacts.activity_timeline': 'available',
  'crm.sales.pipeline': 'available',
  'crm.sales.configurable_stages': 'available',
  'crm.sales.qualification_state': 'partial',
  'crm.data.custom_fields': 'available',
  'crm.data.configurable_views': 'partial',
  'crm.data.csv_import': 'available',
  'communications.voice.inbound_calling': 'available',
  'communications.voice.outbound_calling': 'available',
  'communications.voice.call_controls': 'partial',
  'communications.voice.call_history': 'available',
  'communications.voice.number_inventory': 'available',
  'communications.voice.caller_id': 'available',
  'communications.voice.recording': 'available',
  'communications.voice.call_dispositions': 'available',
  'communications.email.sending': 'available',
  'communications.email.sender_identity': 'available',
  'operations.work_management.work_items': 'available',
  'operations.work_management.work_types_statuses': 'available',
  'operations.work_management.assignment': 'available',
  'operations.work_management.checklists': 'available',
  'operations.work_management.time_cost_capture': 'available',
  'operations.work_management.work_timeline': 'available',
  'operations.scheduling.calendar': 'available',
  'operations.scheduling.availability': 'available',
  'operations.scheduling.rescheduling': 'available',
  'operations.scheduling.scheduling_rules': 'available',
  'operations.resources.resource_records': 'available',
  'operations.resources.capacity_allocation': 'partial',
  'operations.assets_locations.locations': 'available',
  'operations.assets_locations.assets': 'available',
  'operations.assets_locations.asset_history': 'available',
  'operations.dispatch.weather_aware_dispatch': 'partial',
  'financial_operations.pricing.price_book': 'available',
  'financial_operations.pricing.service_rates': 'available',
  'financial_operations.quotes_estimates.quote_creation': 'available',
  'financial_operations.quotes_estimates.quote_to_invoice': 'available',
  'financial_operations.invoicing.invoices': 'available',
  'financial_operations.invoicing.invoice_history': 'available',
  'financial_operations.payments.connected_processor': 'available',
  'financial_operations.payments.card_payments': 'available',
  'financial_operations.job_economics.revenue_costs': 'available',
  'financial_operations.job_economics.gross_margin': 'available',
  'financial_operations.job_economics.estimated_vs_actual': 'partial',
  'automation.workflows.rule_authoring': 'available',
  'automation.triggers.domain_event_trigger': 'available',
  'automation.triggers.counter_trigger': 'available',
  'automation.triggers.external_condition_trigger': 'available',
  'automation.logic.conditions': 'available',
  'automation.logic.branching': 'partial',
  'automation.actions.email_action': 'available',
  'automation.actions.update_customer_action': 'available',
  'automation.actions.update_work_action': 'available',
  'automation.actions.create_work_action': 'available',
  'automation.actions.voice_action': 'partial',
  'automation.runtime_review.run_history': 'available',
  'automation.runtime_review.rule_review': 'available',
  'insights.dashboards.saved_dashboards': 'available',
  'insights.reports.saved_reports': 'available',
  'insights.reports.financial_reports': 'available',
  'insights.analytics.utilization': 'available',
  'insights.analytics.profitability': 'available',
  'insights.intelligence.ask_gold': 'available',
  'customer_experience.website.pages_sections': 'available',
  'customer_experience.website.draft_review_publish': 'available',
  'customer_experience.website.seo_metadata': 'partial',
  'customer_experience.public_booking.service_selection': 'available',
  'customer_experience.public_booking.availability_display': 'available',
  'customer_experience.public_booking.booking': 'available',
  'customer_experience.customer_portal.portal_auth': 'available',
  'customer_experience.customer_portal.portal_history': 'available',
  'customer_experience.forms_intake.booking_intake': 'available',
  'customer_experience.brand_domains.brand_theme': 'available',
  'customer_experience.brand_domains.domain_binding': 'partial',
} as const;

const EVIDENCE: readonly [string, readonly string[]][] = [
  ['crm.customers_contacts', ['apps/web/lib/domain/customers/customers.ts', 'apps/web/features/crm/customers/customer-detail.tsx', 'apps/web/app/organizations/[organizationId]/customers/page.tsx', 'apps/web/tests/reception.test.ts']],
  ['crm.sales', ['apps/web/lib/domain/customers/stages.ts', 'apps/web/features/crm/sales/pipeline-board.tsx', 'apps/web/app/organizations/[organizationId]/customers/pipeline/page.tsx', 'apps/web/tests/reception.test.ts']],
  ['crm.data', ['apps/web/lib/domain/fields/field-definitions.ts', 'apps/web/features/custom-fields/inputs.tsx', 'apps/web/app/organizations/[organizationId]/integrations/imports/page.tsx', 'apps/web/tests/integrations.test.ts']],
  ['communications.voice', ['apps/web/lib/domain/reception/calls.ts', 'apps/web/features/communications/voice/voice-overview.tsx', 'apps/web/app/organizations/[organizationId]/calls/page.tsx', 'apps/web/tests/reception.test.ts']],
  ['communications.email', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/features/automations/templates/template-section.tsx', 'apps/web/app/organizations/[organizationId]/settings/connections/page.tsx', 'apps/web/tests/automations.test.ts']],
  ['operations.work_management', ['apps/web/lib/domain/work-items/work-items.ts', 'apps/web/features/work/work-item-sections.tsx', 'apps/web/app/organizations/[organizationId]/work/page.tsx', 'apps/web/tests/work-items.test.ts']],
  ['operations.scheduling', ['apps/web/lib/domain/scheduling/availability.ts', 'apps/web/app/organizations/[organizationId]/schedule/page.tsx', 'apps/web/tests/scheduling.test.ts']],
  ['operations.resources', ['apps/web/lib/domain/resources/resources.ts', 'apps/web/app/organizations/[organizationId]/resources/page.tsx', 'apps/web/tests/resources.test.ts']],
  ['operations.assets_locations', ['apps/web/lib/domain/assets/assets.ts', 'apps/web/app/organizations/[organizationId]/assets/page.tsx', 'apps/web/tests/location-asset-timeline.test.ts']],
  ['operations.dispatch', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/features/automations/rules/rule-card.tsx', 'apps/web/tests/automations.test.ts']],
  ['financial_operations', ['apps/web/lib/domain/billing/invoices.ts', 'apps/web/features/work/billing-forms.tsx', 'apps/web/app/organizations/[organizationId]/pricing/page.tsx', 'apps/web/tests/invoices.test.ts']],
  ['automation', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/features/automations/rules/rule-card.tsx', 'apps/web/app/organizations/[organizationId]/automations/page.tsx', 'apps/web/tests/automations.test.ts']],
  ['insights', ['apps/web/lib/domain/reporting/definitions.ts', 'apps/web/features/reporting/report-view.tsx', 'apps/web/app/organizations/[organizationId]/reports/page.tsx', 'apps/web/tests/reporting.test.ts']],
  ['customer_experience.website', ['apps/web/lib/domain/public-site/public-site.ts', 'apps/web/features/public-site/homepage-editor.tsx', 'apps/web/app/organizations/[organizationId]/settings/website/page.tsx', 'apps/web/tests/public-site-publishing.test.ts']],
  ['customer_experience.public_booking', ['apps/web/lib/domain/booking/booking.ts', 'apps/web/app/(public)/book/[slug]/page.tsx', 'apps/web/tests/booking.test.ts']],
  ['customer_experience.customer_portal', ['apps/web/lib/domain/portal/portal.ts', 'apps/web/features/portal-access/invite-list.tsx', 'apps/web/app/(public)/portal/[token]/page.tsx', 'apps/web/tests/portal.test.ts']],
  ['customer_experience.forms_intake', ['apps/web/lib/domain/booking/booking.ts', 'apps/web/app/(public)/book/[slug]/booking-form.tsx', 'apps/web/tests/booking.test.ts']],
  ['customer_experience.brand_domains', ['apps/web/lib/domain/branding/brand.ts', 'apps/web/features/branding/brand-style.tsx', 'apps/web/app/organizations/[organizationId]/settings/page.tsx', 'apps/web/tests/branding.test.ts']],
];

const GAPS: Record<string, Partial<Omit<CatalogueSurfaceCoverage, 'key' | 'catalogueState' | 'evidence'>>> = {
  'crm.customers_contacts.ownership_assignment': { domain: 'none', ui: 'none', interaction: 'none', gap: 'No customer owner is stored or shown; catalogue availability overstates the tenant surface.' },
  'crm.customers_contacts.tags_segmentation': { domain: 'none', ui: 'none', interaction: 'none', gap: 'No tag or segment model exists.' },
  'crm.sales.qualification_state': { domain: 'none', ui: 'none', interaction: 'none', gap: 'Stages exist, but no independent qualification state exists.' },
  'crm.data.configurable_views': { domain: 'partial', ui: 'partial', interaction: 'configurable', gap: 'Customers can be filtered, but views cannot be saved.' },
  'communications.voice.inbound_calling': { ui: 'partial', interaction: 'read-only', gap: 'Inbound callbacks are recorded; there is no browser answering surface.' },
  'communications.voice.call_controls': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Conference primitives exist without hold, mute, or transfer UI.' },
  'communications.voice.number_inventory': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Provider resources exist, but tenants only see the selected outbound identity.' },
  'communications.voice.recording': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Recording metadata exists without tenant playback or configuration.' },
  'communications.email.sending': { ui: 'partial', interaction: 'operational', gap: 'Email is sent by automations; there is no general compose surface.' },
  'communications.email.sender_identity': { ui: 'partial', interaction: 'read-only', gap: 'Connection state is visible; tenant self-service provisioning is not.' },
  'operations.resources.capacity_allocation': { ui: 'partial', interaction: 'read-only', gap: 'Committed work is visible without a dedicated capacity-planning surface.' },
  'operations.dispatch.weather_aware_dispatch': { ui: 'partial', interaction: 'configurable', gap: 'Expressed as an automation rule rather than a dispatch workspace.' },
  'financial_operations.job_economics.estimated_vs_actual': { ui: 'partial', interaction: 'read-only', gap: 'Quote and actual figures exist without a dedicated variance view.' },
  'automation.logic.branching': { domain: 'partial', ui: 'partial', gap: 'Conditions exist; multi-branch authoring remains incomplete.' },
  'automation.actions.voice_action': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'No automation authoring control exposes outbound calls.' },
  'customer_experience.website.seo_metadata': { ui: 'partial', interaction: 'configurable', gap: 'Basic metadata exists without the complete SEO surface.' },
  'customer_experience.brand_domains.domain_binding': { domain: 'partial', ui: 'partial', interaction: 'read-only', gap: 'Sending-domain state exists; site-domain binding remains incomplete.' },
};

export const CATALOGUE_SURFACE_COVERAGE: readonly CatalogueSurfaceCoverage[] = Object.entries(FEATURE_STATES).map(([key, catalogueState]) => {
  const evidence = EVIDENCE.find(([prefix]) => key.startsWith(prefix))?.[1] ?? [];
  const base: CatalogueSurfaceCoverage = {
    key,
    catalogueState,
    domain: catalogueState === 'available' ? 'complete' : 'partial',
    ui: catalogueState === 'available' ? 'usable' : 'partial',
    interaction: 'operational',
    test: key.startsWith('crm.') || key.startsWith('communications.voice.') ? 'E2E' : 'integration',
    evidence,
    gap: null,
  };
  return { ...base, ...GAPS[key] };
});
