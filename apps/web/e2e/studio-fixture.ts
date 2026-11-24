import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * The observed production shape of GildOps' own website, rebuilt in a disposable business: a
 * migration publishes the homepage, the owner opens a draft from it in Studio, and later migrations
 * publish two newer homepages around that draft without touching it. The draft is a legacy row:
 * it records no base revision, exactly like the one it stands in for.
 *
 * The business is made GildOps' public site for the run (platform settings are restored on
 * teardown), so the marketing experience is the one Studio has to represent.
 */
export type StudioFixture = {
  organizationId: string;
  siteId: string;
  draftId: string;
  draftNumber: number;
  publishedId: string;
  publishedNumber: number;
  previous: { gold_public_organization_id: string | null; gold_public_site_id: string | null };
};

export const STALE_DRAFT_HEADING = 'Run your business from one connected system.';

const fixtureFile = (directory: string) => path.join(directory, 'studio.json');

export function loadStudioFixture(): StudioFixture {
  return JSON.parse(readFileSync(fixtureFile(process.env.E2E_FIXTURE_DIR!), 'utf8')) as StudioFixture;
}

/** A migration-style publication, the same statements 20261109000004 runs: archive, insert, move the pointer. */
const REPUBLISH = `
with current_revision as (
  select r.* from public.public_site_revisions r
  join public.public_sites s on s.organization_id = r.organization_id and s.id = r.site_id and s.current_published_revision_id = r.id
  where s.organization_id = $1
), archived as (
  update public.public_site_revisions r set status = 'archived', archived_at = now()
  from current_revision c where r.organization_id = c.organization_id and r.id = c.id
  returning r.id
), inserted as (
  insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, navigation, created_source, submitted_at, published_at)
  select c.organization_id, c.site_id,
         (select max(revision_number) + 1 from public.public_site_revisions where organization_id = c.organization_id and site_id = c.site_id),
         'published', c.pages, c.navigation, 'migration', now(), now()
  from current_revision c, archived
  returning id, organization_id, site_id
)
update public.public_sites s set current_published_revision_id = i.id
from inserted i where s.organization_id = i.organization_id and s.id = i.site_id
returning i.id`;

export async function createStudioFixture(connection: string, organizationId: string, ownerId: string, directory: string): Promise<StudioFixture> {
  const pg = new Client(connection);
  await pg.connect();
  try {
    const previous = (await pg.query('select gold_public_organization_id, gold_public_site_id from public.platform_settings where singleton')).rows[0];
    // Recorded first, so teardown can restore the settings even if a later step fails.
    writeFileSync(fixtureFile(directory), JSON.stringify({ organizationId, previous }, null, 2));
    const { rows: [{ site }] } = await pg.query<{ site: string }>('select app.bootstrap_gold_public_site($1) as site', [organizationId]);
    // The first homepage was published in early September, before the owner's draft. Published rows
    // are immutable, so backdating this disposable one bypasses the guard for this statement only.
    await pg.query('begin');
    await pg.query('set local session_replication_role = replica');
    await pg.query(`update public.public_site_revisions set created_at = timestamptz '2026-09-01 12:00:00+00', published_at = timestamptz '2026-09-01 12:00:00+00', submitted_at = timestamptz '2026-09-01 12:00:00+00'
                     where organization_id = $1 and status = 'published'`, [organizationId]);
    await pg.query('commit');

    // The owner's draft, opened in Studio on 30 September from the homepage published then.
    const { rows: [draft] } = await pg.query<{ id: string; revision_number: number }>(`
      insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, navigation, created_source, created_by, created_at)
      select r.organization_id, r.site_id, r.revision_number + 1, 'draft',
             (select jsonb_agg(case when (p ->> 'isHome')::boolean then jsonb_set(p, '{sections,0,heading}', to_jsonb($3::text)) else p end)
                from jsonb_array_elements(r.pages) p),
             r.navigation, 'account', $2, timestamptz '2026-09-30 14:00:00+00'
      from public.public_site_revisions r
      join public.public_sites s on s.organization_id = r.organization_id and s.current_published_revision_id = r.id
      where r.organization_id = $1
      returning id, revision_number`, [organizationId, ownerId, STALE_DRAFT_HEADING]);

    await pg.query(REPUBLISH, [organizationId]);
    const { rows: [latest] } = await pg.query<{ id: string }>(REPUBLISH, [organizationId]);
    const { rows: [published] } = await pg.query<{ revision_number: number }>('select revision_number from public.public_site_revisions where id = $1', [latest!.id]);

    const fixture: StudioFixture = {
      organizationId, siteId: site, draftId: draft!.id, draftNumber: draft!.revision_number,
      publishedId: latest!.id, publishedNumber: published!.revision_number, previous,
    };
    writeFileSync(fixtureFile(directory), JSON.stringify(fixture, null, 2));
    return fixture;
  } finally {
    await pg.end();
  }
}

/** Website rows are immutable once published, so removing a disposable one bypasses the guards for this session only. */
export async function removeStudioFixture(connection: string, directory: string): Promise<void> {
  let fixture: Pick<StudioFixture, 'organizationId' | 'previous'>;
  try { fixture = JSON.parse(readFileSync(fixtureFile(directory), 'utf8')) as StudioFixture; } catch { return; }
  const pg = new Client(connection);
  await pg.connect();
  try {
    await pg.query('begin');
    await pg.query('set local session_replication_role = replica');
    await pg.query('update public.platform_settings set gold_public_organization_id = $1, gold_public_site_id = $2 where singleton',
      [fixture.previous.gold_public_organization_id, fixture.previous.gold_public_site_id]);
    await pg.query('delete from public.events where organization_id = $1 and entity_type = $2', [fixture.organizationId, 'public_site_revision']);
    await pg.query('update public.public_sites set current_published_revision_id = null where organization_id = $1', [fixture.organizationId]);
    await pg.query('delete from public.public_site_revisions where organization_id = $1', [fixture.organizationId]);
    await pg.query('delete from public.public_sites where organization_id = $1', [fixture.organizationId]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  } finally {
    await pg.end();
  }
}

export async function revisionCount(connection: string, organizationId: string): Promise<number> {
  const pg = new Client(connection);
  await pg.connect();
  try {
    return (await pg.query<{ n: number }>('select count(*)::int as n from public.public_site_revisions where organization_id = $1', [organizationId])).rows[0]!.n;
  } finally {
    await pg.end();
  }
}
