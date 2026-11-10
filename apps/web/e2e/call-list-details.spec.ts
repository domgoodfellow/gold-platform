import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createContact } from '../lib/domain/contacts/contacts';
import { addToCallList } from '../lib/application/communications/call-list';
import { dialerContactCandidates } from '../lib/domain/reception/calls';
import { localDateTimeToInstant } from '../lib/domain/scheduling/window';
import { chooseOption } from './select-field';

test.use({ storageState: OWNER_STORAGE_STATE });
test('call-list task details persist atomically and typed-number matching refuses ambiguity and unauthorized reads', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const { organizationId, ownerEmail } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  for (const name of ['SUPABASE_URL', 'SUPABASE_DB_URL']) if (!['localhost', '127.0.0.1'].includes(new URL(process.env[name]!).hostname)) throw new Error('Local fixtures only.');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (login.error) throw login.error;
  const pg = new Client(process.env.SUPABASE_DB_URL!); await pg.connect();
  try {
    const org = (await pg.query<{ timezone: string }>('select timezone from organizations where id=$1', [organizationId])).rows[0];
    const owner = (await pg.query<{ id: string; display_name: string }>('select id,display_name from memberships where organization_id=$1 and user_id=$2', [organizationId, login.data.user.id])).rows[0];
    const contact = await createContact(db, { organizationId, name: 'Call workflow fixture', phone: '+14165550988', contactType: 'person' });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/crm/contacts/${contact}`);
      await page.getByRole('button', { name: 'Add to…', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Call list', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add to call list' });
      await dialog.getByLabel('Due', { exact: true }).fill('2026-11-12T14:30');
      await chooseOption(dialog.getByRole('combobox', { name: 'Owner', exact: true }), owner.display_name);
      await dialog.getByRole('textbox', { name: /^Note/ }).fill('Discuss the renewal');
      await expect(dialog.getByRole('button', { name: 'Add 1', exact: true })).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`call-list-${width}.png`), fullPage: true });
      if (width === 390) {
        await dialog.getByRole('button', { name: 'Add 1', exact: true }).click();
        await expect(dialog).toBeHidden();
      } else {
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Discard', exact: true }).click();
      }
    }
    const saved = await pg.query('select due_at,owner_membership_id,notes from crm_tasks where organization_id=$1 and customer_id=$2 and kind=$3', [organizationId, contact, 'call']);
    expect(saved.rows).toHaveLength(1);
    expect(new Date(saved.rows[0].due_at).toISOString()).toBe(localDateTimeToInstant('2026-11-12T14:30', org.timezone));
    expect(saved.rows[0]).toMatchObject({ owner_membership_id: owner.id, notes: 'Discuss the renewal' });
    const fresh = await createContact(db, { organizationId, name: 'Refused owner fixture', phone: '+14165550989' });
    await expect(addToCallList(db, { organizationId, target: { customerIds: [fresh] }, ownerMembershipId: '99999999-9999-4999-8999-999999999999', notes: 'Must not be saved' })).rejects.toThrow();
    expect((await pg.query('select id from crm_tasks where organization_id=$1 and customer_id=$2', [organizationId, fresh])).rows).toHaveLength(0);
    expect(await dialerContactCandidates(db, { organizationId, number: '+1 (416) 555-0988' })).toMatchObject([{ id: contact }]);
    await page.goto(`${base}/calls?to=%2B14165550988`);
    await expect(page.getByRole('heading', { name: 'Call workflow fixture', exact: true })).toBeVisible();
    await createContact(db, { organizationId, name: 'Shared phone fixture', phone: '+14165550988' });
    expect(await dialerContactCandidates(db, { organizationId, number: '+14165550988' })).toHaveLength(2);
    await expect(dialerContactCandidates(db, { organizationId: '99999999-9999-4999-8999-999999999999', number: '+14165550988' })).rejects.toThrow();
    const denied = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    try {
      const member = await denied.newPage();
      await member.goto(`${base}/crm/contacts/${contact}`);
      await expect(member.getByRole('button', { name: 'Add to…', exact: true })).toHaveCount(0);
    } finally { await denied.close(); }
  } finally { await pg.end(); }
});
