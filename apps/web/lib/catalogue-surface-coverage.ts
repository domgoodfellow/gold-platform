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
  'sales.customers_contacts.customer_profile': 'available',
  'sales.customers_contacts.ownership_assignment': 'available',
  'sales.customers_contacts.tags_segmentation': 'partial',
  'sales.customers_contacts.activity_timeline': 'available',
  'sales.sales.pipeline': 'available',
  'sales.sales.configurable_stages': 'available',
  'sales.sales.qualification_state': 'partial',
  'sales.data.custom_fields': 'available',
  'sales.data.configurable_views': 'partial',
  'sales.data.file_imports': 'available',
  'sales.data.app_connections': 'partial',
  'sales.data.data_mapping': 'available',
  'comms.voice.inbound_calling': 'available',
  'comms.voice.outbound_calling': 'available',
  'comms.voice.call_controls': 'partial',
  'comms.voice.call_history': 'available',
  'comms.voice.number_inventory': 'available',
  'comms.voice.caller_id': 'available',
  'comms.voice.recording': 'available',
  'comms.voice.call_dispositions': 'available',
  'comms.email.sending': 'available',
  'comms.email.sender_identity': 'available',
  'field.work_management.work_items': 'available',
  'field.work_management.work_types_statuses': 'available',
  'field.work_management.assignment': 'available',
  'field.work_management.checklists': 'available',
  'field.work_management.time_cost_capture': 'available',
  'field.work_management.work_timeline': 'available',
  'field.scheduling.calendar': 'available',
  'field.scheduling.availability': 'available',
  'field.scheduling.rescheduling': 'available',
  'field.scheduling.scheduling_rules': 'available',
  'field.resources.resource_records': 'available',
  'field.resources.capacity_allocation': 'partial',
  'field.assets_locations.locations': 'available',
  'field.assets_locations.assets': 'available',
  'field.assets_locations.asset_history': 'available',
  'field.dispatch.weather_aware_dispatch': 'partial',
  'finance.pricing.price_book': 'available',
  'finance.pricing.service_rates': 'available',
  'finance.quotes_estimates.quote_creation': 'available',
  'finance.quotes_estimates.quote_to_invoice': 'available',
  'finance.invoicing.invoices': 'available',
  'finance.invoicing.invoice_history': 'available',
  'finance.payments.connected_processor': 'available',
  'finance.payments.card_payments': 'available',
  'finance.job_economics.revenue_costs': 'available',
  'finance.job_economics.gross_margin': 'available',
  'finance.job_economics.estimated_vs_actual': 'partial',
  'automations.workflows.rule_authoring': 'available',
  'automations.triggers.domain_event_trigger': 'available',
  'automations.triggers.counter_trigger': 'available',
  'automations.triggers.external_condition_trigger': 'available',
  'automations.logic.conditions': 'available',
  'automations.logic.branching': 'partial',
  'automations.actions.email_action': 'available',
  'automations.actions.update_customer_action': 'available',
  'automations.actions.update_work_action': 'available',
  'automations.actions.create_work_action': 'available',
  'automations.actions.voice_action': 'partial',
  'automations.runtime_review.run_history': 'available',
  'automations.runtime_review.rule_review': 'available',
  'workspace.dashboards.saved_dashboards': 'available',
  'workspace.reports.saved_reports': 'available',
  'workspace.reports.financial_reports': 'available',
  'workspace.analytics.utilization': 'available',
  'workspace.analytics.profitability': 'available',
  'agents.intelligence.ask_gold': 'available',
  'studio.website.pages_sections': 'available',
  'studio.website.draft_review_publish': 'available',
  'studio.website.seo_metadata': 'partial',
  'studio.public_booking.service_selection': 'available',
  'studio.public_booking.availability_display': 'available',
  'studio.public_booking.booking': 'available',
  'studio.customer_portal.portal_auth': 'available',
  'studio.customer_portal.portal_history': 'available',
  'studio.forms_intake.booking_intake': 'available',
  'studio.brand_domains.brand_theme': 'available',
  'studio.brand_domains.domain_binding': 'partial',
} as const;

const EVIDENCE: readonly [string, readonly string[]][] = [
  ['sales.customers_contacts', ['apps/web/lib/domain/customers/customers.ts', 'apps/web/features/crm/customers/customer-detail.tsx', 'apps/web/app/organizations/[organizationId]/customers/page.tsx', 'apps/web/tests/integration/database/reception.test.ts']],
  ['sales.sales', ['apps/web/lib/domain/customers/stages.ts', 'apps/web/features/crm/sales/pipeline-board.tsx', 'apps/web/app/organizations/[organizationId]/customers/pipeline/page.tsx', 'apps/web/tests/integration/database/reception.test.ts']],
  ['sales.data', ['apps/web/lib/domain/fields/field-definitions.ts', 'apps/web/features/custom-fields/inputs.tsx', 'apps/web/app/organizations/[organizationId]/integrations/imports/page.tsx', 'apps/web/tests/integration/database/integrations.test.ts']],
  ['comms.voice', ['apps/web/lib/domain/reception/calls.ts', 'apps/web/features/communications/voice/voice-overview.tsx', 'apps/web/app/organizations/[organizationId]/calls/page.tsx', 'apps/web/tests/integration/database/reception.test.ts']],
  ['comms.email', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/features/automations/templates/messages-view.tsx', 'apps/web/app/organizations/[organizationId]/settings/communications/page.tsx', 'apps/web/tests/integration/database/automations.test.ts']],
  ['field.work_management', ['apps/web/lib/domain/work-items/work-items.ts', 'apps/web/features/work/work-item-sections.tsx', 'apps/web/app/organizations/[organizationId]/work/page.tsx', 'apps/web/tests/integration/database/work-items.test.ts']],
  ['field.scheduling', ['apps/web/lib/domain/scheduling/availability.ts', 'apps/web/app/organizations/[organizationId]/schedule/page.tsx', 'apps/web/tests/integration/database/scheduling.test.ts']],
  ['field.resources', ['apps/web/lib/domain/resources/resources.ts', 'apps/web/app/organizations/[organizationId]/resources/page.tsx', 'apps/web/tests/integration/database/resources.test.ts']],
  ['field.assets_locations', ['apps/web/lib/domain/assets/assets.ts', 'apps/web/app/organizations/[organizationId]/assets/page.tsx', 'apps/web/tests/integration/database/location-asset-timeline.test.ts']],
  ['field.dispatch', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/features/automations/rules/action-list.tsx', 'apps/web/tests/integration/database/automations.test.ts']],
  ['finance', ['apps/web/lib/domain/billing/invoices.ts', 'apps/web/features/work/billing-forms.tsx', 'apps/web/app/organizations/[organizationId]/pricing/page.tsx', 'apps/web/tests/integration/database/invoices.test.ts']],
  ['automations', ['apps/web/lib/domain/automation/rules.ts', 'apps/web/app/organizations/[organizationId]/automations/[ruleId]/page.tsx', 'apps/web/app/organizations/[organizationId]/automations/page.tsx', 'apps/web/tests/integration/database/automations.test.ts']],
  ['agents', ['apps/web/lib/domain/assistant/questions.ts', 'apps/web/features/agent/tenant-agent-rail.tsx', 'apps/web/features/agent/actions.ts']],
  ['workspace', ['apps/web/lib/domain/reporting/definitions.ts', 'apps/web/features/reporting/report-view.tsx', 'apps/web/app/organizations/[organizationId]/insights/reports/page.tsx', 'apps/web/tests/integration/database/reporting.test.ts']],
  ['studio.website', ['apps/web/lib/domain/public-site/public-site.ts', 'apps/web/features/public-site/homepage-editor.tsx', 'apps/web/app/organizations/[organizationId]/settings/website/page.tsx', 'apps/web/tests/integration/database/public-site-publishing.test.ts']],
  ['studio.public_booking', ['apps/web/lib/domain/booking/booking.ts', 'apps/web/app/(public)/book/[slug]/page.tsx', 'apps/web/tests/integration/database/booking.test.ts']],
  ['studio.customer_portal', ['apps/web/lib/domain/portal/portal.ts', 'apps/web/features/portal-access/invite-list.tsx', 'apps/web/app/(public)/portal/[token]/page.tsx', 'apps/web/tests/integration/database/portal.test.ts']],
  ['studio.forms_intake', ['apps/web/lib/domain/booking/booking.ts', 'apps/web/app/(public)/book/[slug]/booking-form.tsx', 'apps/web/tests/integration/database/booking.test.ts']],
  ['studio.brand_domains', ['apps/web/lib/domain/branding/brand.ts', 'apps/web/features/branding/brand-style.tsx', 'apps/web/app/organizations/[organizationId]/settings/page.tsx', 'apps/web/tests/integration/database/branding.test.ts']],
];

const GAPS: Record<string, Partial<Omit<CatalogueSurfaceCoverage, 'key' | 'catalogueState' | 'evidence'>>> = {
  'sales.customers_contacts.ownership_assignment': { domain: 'none', ui: 'none', interaction: 'none', gap: 'No customer owner is stored or shown; catalogue availability overstates the tenant surface.' },
  'sales.customers_contacts.tags_segmentation': { domain: 'none', ui: 'none', interaction: 'none', gap: 'No tag or segment model exists.' },
  'sales.sales.qualification_state': { domain: 'none', ui: 'none', interaction: 'none', gap: 'Stages exist, but no independent qualification state exists.' },
  'sales.data.configurable_views': { domain: 'partial', ui: 'partial', interaction: 'configurable', gap: 'Customers can be filtered, but views cannot be saved.' },
  'sales.data.app_connections': { domain: 'partial', ui: 'partial', interaction: 'configurable', gap: 'The connector catalogue exists and a file connection works; no app connector has an authorization flow yet.' },
  'comms.voice.inbound_calling': { ui: 'partial', interaction: 'read-only', gap: 'Inbound callbacks are recorded; there is no browser answering surface.' },
  'comms.voice.call_controls': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Conference primitives exist without hold, mute, or transfer UI.' },
  'comms.voice.number_inventory': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Provider resources exist, but tenants only see the selected outbound identity.' },
  'comms.voice.recording': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'Recording metadata exists without tenant playback or configuration.' },
  'comms.email.sending': { ui: 'partial', interaction: 'operational', gap: 'Email is sent by automations; there is no general compose surface.' },
  'comms.email.sender_identity': { ui: 'partial', interaction: 'read-only', gap: 'Connection state is visible; tenant self-service provisioning is not.' },
  'field.resources.capacity_allocation': { ui: 'partial', interaction: 'read-only', gap: 'Committed work is visible without a dedicated capacity-planning surface.' },
  'field.dispatch.weather_aware_dispatch': { ui: 'partial', interaction: 'configurable', gap: 'Expressed as an automation rule rather than a dispatch workspace.' },
  'finance.job_economics.estimated_vs_actual': { ui: 'partial', interaction: 'read-only', gap: 'Quote and actual figures exist without a dedicated variance view.' },
  'automations.logic.branching': { domain: 'partial', ui: 'partial', gap: 'Conditions exist; multi-branch authoring remains incomplete.' },
  'automations.actions.voice_action': { domain: 'partial', ui: 'none', interaction: 'none', gap: 'No automation authoring control exposes outbound calls.' },
  'studio.website.seo_metadata': { ui: 'partial', interaction: 'configurable', gap: 'Basic metadata exists without the complete SEO surface.' },
  'studio.brand_domains.domain_binding': { domain: 'partial', ui: 'partial', interaction: 'read-only', gap: 'Sending-domain state exists; site-domain binding remains incomplete.' },
};

export const CATALOGUE_SURFACE_COVERAGE: readonly CatalogueSurfaceCoverage[] = Object.entries(FEATURE_STATES).map(([key, catalogueState]) => {
  const evidence = EVIDENCE.find(([prefix]) => key.startsWith(prefix))?.[1] ?? [];
  const base: CatalogueSurfaceCoverage = {
    key,
    catalogueState,
    domain: catalogueState === 'available' ? 'complete' : 'partial',
    ui: catalogueState === 'available' ? 'usable' : 'partial',
    interaction: 'operational',
    test: key.startsWith('sales.') || key.startsWith('comms.voice.') ? 'E2E' : 'integration',
    evidence,
    gap: null,
  };
  return { ...base, ...GAPS[key] };
});
