import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createContact } from '../lib/domain/contacts/contacts';
import { createEmailIdentity } from '../lib/domain/email/identities';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { listConversationFeed, conversationFeedCounts } from '../lib/domain/reception/conversation-feed';
import { chooseOption } from './select-field';

test.use({ storageState: OWNER_STORAGE_STATE });
test('Conversations pages mixed channel records without merging them and exposes contact calling context', async ({ page }, info) => {
  test.setTimeout(180_000);
  for (const key of ['SUPABASE_URL', 'SUPABASE_DB_URL']) if (!['localhost', '127.0.0.1'].includes(new URL(process.env[key]!).hostname)) throw new Error('Local fixtures only.');
  const { organizationId, ownerEmail } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD }); if (login.error) throw login.error;
  const pg = new Client(process.env.SUPABASE_DB_URL!); await pg.connect();
  try {
    const contact = await createContact(db, { organizationId, name: 'Conversation fixture contact', email: 'conversation-fixture@example.test', phone: '+14165550888', contactType: 'person' });
    const domain = await db.rpc('record_organization_email_domain', { p_organization_id: organizationId, p_domain: 'conversation-fixture.example.test' }); if (domain.error) throw domain.error;
    const address = 'hello@conversation-fixture.example.test';
    const identity = await createEmailIdentity(db, { organizationId, address, sendingDomainResourceId: domain.data as string });
    await pg.query('begin');
    await pg.query('set local role provider_operator');
    await pg.query("select record_email_domain_provisioning($1,$2,'active')", [organizationId, domain.data]);
    await pg.query('commit');
    const receiving = await db.from('email_identities').update({ can_receive: true }).eq('organization_id', organizationId).eq('id', identity.id); if (receiving.error) throw receiving.error;
    const emailIds: string[] = [];
    for (const subject of ['Email fixture one', 'Email fixture two']) {
      await pg.query('begin');
      await pg.query('set local role tenant_email_webhook');
      const inbound = await pg.query("select record_inbound_email($1,$2,$3,$4,$5,null,'{}',$6,'Email fixture body',null,now(),null,'[]'::jsonb) as result", [[address], 'conversation-fixture@example.test', `in_${randomUUID()}`, `evt_${randomUUID()}`, `<${randomUUID()}@example.test>`, subject]);
      await pg.query('commit');
      const row = await pg.query('select conversation_id from messages where id=$1', [inbound.rows[0].result.message_id]);
      emailIds.push(row.rows[0].conversation_id);
    }
    const thread = (await pg.query("insert into communication_threads(organization_id,channel,state) values($1,'web','handoff_requested') returning id", [organizationId])).rows[0].id as string;
    await pg.query("insert into communication_entries(organization_id,thread_id,channel,direction,body) values($1,$2,'web','inbound','Website fixture question')", [organizationId, thread]);
    const at = '2026-11-10T12:00:00Z';
    await pg.query('update conversations set last_message_at=$2 where organization_id=$1', [organizationId, at]);
    await pg.query('update communication_threads set updated_at=$2 where organization_id=$1', [organizationId, at]);
    await pg.query('update communication_entries set created_at=$2 where organization_id=$1', [organizationId, at]);
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const result = await listConversationFeed(db, { organizationId, filter: { search: 'fixture', status: 'any' }, limit: 1, cursor });
      seen.push(...result.items.map(item => `${item.source}:${item.id}`)); cursor = result.nextCursor;
    } while (cursor && seen.length < 5);
    expect(seen).toHaveLength(3); expect(new Set(seen).size).toBe(3);
    expect((await conversationFeedCounts(db, { organizationId })).open).toBe(3);
    const website = await listConversationFeed(db, { organizationId, filter: { channel: 'web' } });
    expect(website.items).toMatchObject([{ id: thread, source: 'website', unread: null, sourceStatus: 'handoff_requested' }]);
    expect((await listConversationFeed(db, { organizationId, filter: { channel: 'web', view: 'unread' } })).items).toEqual([]);

    // Another real tenant's row exists, but this session cannot read it through the projection.
    const colleague = (await pg.query('select u.email from memberships m join auth.users u on u.id=m.user_id where m.organization_id=$1 and m.user_id<>$2 limit 1', [organizationId, login.data.user.id])).rows[0].email as string;
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [login.data.user.id, 'Disposable Conversations fixture']);
    try {
      const foreign = await provisionOrganization(db, { ownerEmail: colleague, name: 'Private conversation fixture', currency: 'CAD' });
      const manifestPath = path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); manifest.organizationIds.push(foreign); writeFileSync(manifestPath, JSON.stringify(manifest));
      await pg.query("insert into communication_threads(organization_id,channel,state) values($1,'web','open')", [foreign]);
      expect((await listConversationFeed(db, { organizationId: foreign })).items).toEqual([]);
    } finally { await pg.query('delete from platform_staff where user_id=$1', [login.data.user.id]); }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/comms/inbox`);
      await expect(page.getByRole('link').filter({ hasText: 'Website fixture question' })).toBeVisible();
      await chooseOption(page.getByRole('combobox', { name: 'Messaging channel' }), 'Website chat');
      const row = page.getByRole('link').filter({ hasText: 'Website fixture question' });
      await row.click();
      await expect(page.getByRole('button', { name: 'Claim', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Website reply' })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`website-thread-${width}.png`), fullPage: true });
      await page.goto(`${base}/comms/inbox/${emailIds[0]}`);
      await expect(page.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', `${base}/calls?to=%2B14165550888`);
      await page.getByRole('button', { name: 'Contact details', exact: true }).click();
      const context = width === 1440 ? page.getByRole('complementary', { name: 'Contact details' }) : page.getByRole('dialog', { name: 'Contact details' });
      await expect(context.getByRole('link', { name: 'Open contact', exact: true })).toHaveAttribute('href', `${base}/crm/contacts/${contact}`);
      await expect(context).toContainText('(416)555-0888');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`conversation-contact-${width}.png`), fullPage: true });
    }
  } finally { await pg.query('rollback'); await pg.end(); }
});
