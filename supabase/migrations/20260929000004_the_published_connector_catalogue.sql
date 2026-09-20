-- The published connector catalogue — the one read an anonymous visitor to GOLD's site has (D55).
--
-- **A projection, not a grant.** `platform_connectors` is readable by signed-in callers only, and
-- stays that way. This function is what the marketing site calls: it returns the public-facing
-- columns of rows an admin has marked public *and* written public copy for, and nothing
-- operational — no auth method, no capabilities, no `description` (the in-product text).
--
-- **Providers can never appear here.** It reads `platform_connectors` alone; `platform_providers`
-- has no path into it, so a change to a provider cannot leak onto the public page.
--
-- **A row with no public summary is not published**, whatever `is_public` says: publishing is an
-- act of writing what the public should read, not a side effect of a flag.

create function public.published_connectors()
returns table (
  key                   text,
  name                  text,
  category              text,
  suite                 text,
  status                text,
  marketing_slug        text,
  marketing_summary     text,
  marketing_description text,
  icon_ref              text,
  apps                  jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.key, c.name, c.category, c.suite, c.status, c.marketing_slug, c.marketing_summary,
         c.marketing_description, c.icon_ref,
         coalesce(
           (select jsonb_agg(a.name order by a.display_order, a.name)
              from public.platform_connector_apps a where a.connector_id = c.id),
           '[]'::jsonb)
    from public.platform_connectors c
   where c.is_public
     and btrim(c.marketing_summary) <> ''
   order by c.display_order, c.name;
$fn$;

comment on function public.published_connectors() is
  'What the public site may say about connectors: public rows with public copy, public columns only. Reads platform_connectors alone, so a provider can never appear here (D55).';

revoke all on function public.published_connectors() from public;
grant execute on function public.published_connectors() to anon, authenticated;

-- Public copy for the seed. Written apart from `description` on purpose: what the public site
-- says is editable without touching anything that runs.
update public.platform_connectors set marketing_summary = v.summary, marketing_slug = v.slug
from (values
  ('csv',              'Bring customers in from a spreadsheet.',                      'csv'),
  ('google_workspace', 'Drive, Calendar, Gmail, Docs and Sheets, through one sign-in.', 'google-workspace'),
  ('microsoft_365',    'OneDrive, Outlook, Calendar, Excel and Teams, through one sign-in.', 'microsoft-365'),
  ('notion',           'Pages and databases from a Notion workspace.',                'notion'),
  ('slack',            'Tell a channel when something happens.',                      'slack'),
  ('dropbox',          'Files and folders.',                                          'dropbox'),
  ('hubspot',          'Contacts, companies and sales pipelines.',                    'hubspot'),
  ('salesforce',       'Contacts, accounts and opportunities.',                       'salesforce'),
  ('quickbooks',       'Customers, invoices and accounts.',                           'quickbooks'),
  ('shopify',          'Customers, orders and products.',                             'shopify')
) as v (key, summary, slug)
where platform_connectors.key = v.key;
