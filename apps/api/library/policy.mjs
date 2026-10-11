// Package policy chooses identity and permission; names, icons and action schemas come from imports.
export const families = {
  google: ['google-drive', 'google-calendar', 'google-sheets', 'gmail', 'google-contacts'],
  microsoft: ['microsoft-excel-365', 'microsoft-onedrive', 'microsoft-outlook', 'microsoft-outlook-calendar', 'microsoft-teams'],
};
export const categories = {
  'CRM & Sales': ['salesforce', 'hubspot', 'pipedrive', 'airtable', 'google-contacts'],
  'Accounting & Finance': ['quickbooks', 'xero'],
  Payments: ['stripe', 'square'],
  Commerce: ['shopify', 'woocommerce'],
  'Marketing & Advertising': ['mailchimp'],
  Communications: ['gmail', 'microsoft-outlook', 'microsoft-teams', 'slack', 'discord', 'telegram-bot'],
  'Customer Support': ['zendesk', 'intercom', 'linear'],
  'Scheduling & Calendars': ['google-calendar', 'microsoft-outlook-calendar'],
  'Files & Cloud Storage': ['google-drive', 'microsoft-onedrive', 'dropbox'],
  'Documents & Productivity': ['google-sheets', 'microsoft-excel-365', 'notion'],
  'Developer Tools': ['github', 'gitlab'],
  'Website & Content Management': ['wordpress'],
  'AI & Agents': ['openai'],
  'Project Management': ['asana', 'trello', 'clickup'],
};
export function identity(slug) {
  if (families.google.includes(slug)) return 'google_workspace';
  if (families.microsoft.includes(slug)) return 'microsoft_365';
  return slug.replaceAll('-', '_');
}
export function categoryFor(slug) {
  return Object.entries(categories).find(([, slugs]) => slugs.includes(slug))?.[0] ?? 'Automation';
}
export function workspaceFor(category) {
  return ({ 'CRM & Sales': 'crm', 'Accounting & Finance': 'finance', Payments: 'finance', Commerce: 'finance',
    'Marketing & Advertising': 'marketing', Communications: 'communications', 'Customer Support': 'support',
    'Scheduling & Calendars': 'field', 'Developer Tools': 'studio', 'Website & Content Management': 'studio',
    'AI & Agents': 'ai', 'Project Management': 'automations' })[category] ?? 'library';
}
// An upstream classification is descriptive, not permission to execute. These reviewed reads are the executable surface.
export const reads = {
  'google-drive': ['drive_list_files', 'drive_get_file', 'drive_search_files', 'drive_list_shared_drives'],
  'google-calendar': ['google_calendar_list_calendars', 'google_calendar_list_events', 'google_calendar_get_event'],
  'google-sheets': ['sheets_get_spreadsheet', 'sheets_get_values', 'sheets_get_row', 'sheets_get_all_rows', 'sheets_search_spreadsheets'],
  gmail: ['get_email', 'search_email'],
  'google-contacts': ['search_contacts'],
  'microsoft-excel-365': ['get_worksheets', 'get_worksheet_rows', 'get_range', 'get_workbooks'],
  'microsoft-onedrive': ['onedrive_get_item', 'onedrive_list_folder_children', 'onedrive_list_drives'],
  'microsoft-outlook': ['list_messages'],
  'microsoft-outlook-calendar': ['list_events'],
  salesforce: ['find_record', 'run_query'], hubspot: ['get-contact', 'find-contact', 'get-company', 'find-company'],
  pipedrive: ['get-person', 'get-deal', 'list-persons', 'list-deals'], airtable: ['list_bases', 'list_records', 'get_record', 'get_current_user'],
  stripe: ['get_customer', 'list_customers', 'get_invoice', 'list_invoices', 'list_payment_intents', 'list_payouts', 'list_charges'],
  square: ['get_merchant', 'list_customers', 'list_payments'], quickbooks: ['find_customer', 'find_invoice'],
  xero: ['xero_list_organisations', 'xero_find_contact', 'xero_find_invoice', 'xero_get_invoice'],
  shopify: ['get_customer', 'get_customers', 'get_order', 'search_orders', 'get_shop'], woocommerce: ['list_orders', 'list_customers'],
  slack: ['get_channel_history', 'list_channels'], notion: ['search', 'retrieve_page'],
  dropbox: ['list_folder'], github: ['list_my_repositories', 'get_file_content'],
  zendesk: ['get_ticket', 'search_tickets'], intercom: ['list_contacts'], linear: ['get_issue'],
  asana: ['get_current_user', 'list_projects', 'get_task'], trello: ['get_board', 'get_card'], clickup: ['get_task'],
};
