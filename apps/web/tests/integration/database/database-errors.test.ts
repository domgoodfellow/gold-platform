import { createClient } from '@supabase/supabase-js';
import { Client, type DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * A database refusal reaches a person only through `fromDatabaseError` (docs/ui-system.md → Words
 * we use). Each case here is a real refusal from local PostgreSQL, so the wording the translation
 * recognises is Postgres's own, not a copy of it: a unique value, a foreign key in both directions,
 * a check, row security, a sentence a database function raised on purpose, and an unknown failure.
 */

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

let pg: Client;

beforeAll(async () => {
  pg = new Client(CONNECTION);
  await pg.connect();
  await pg.query(`
    create temp table parent (id int primary key, name text unique);
    create temp table child (id int primary key, parent_id int references parent (id), qty int check (qty > 0));
    insert into parent values (1, 'Plumbing');
    insert into child values (1, 1, 1);
  `);
});

afterAll(async () => {
  await pg?.end();
});

/** The error a statement raises, in the shape PostgREST forwards (`code`, `message`). */
async function refusal(sql: string): Promise<{ code: string; message: string }> {
  try {
    await pg.query(sql);
  } catch (caught) {
    const error = caught as DatabaseError;
    return { code: error.code ?? '', message: error.message };
  }
  throw new Error(`Expected a refusal from: ${sql}`);
}

describe('fromDatabaseError, against real refusals', () => {
  it('turns a duplicate value into "That already exists."', async () => {
    const error = await refusal(`insert into parent values (2, 'Plumbing')`);
    expect(error.code).toBe('23505');
    const translated = fromDatabaseError(error, 'services.save_failed');
    expect(translated).toBeInstanceOf(DomainError);
    expect(translated).toMatchObject({ message: 'That already exists.', code: 'services.save_failed' });
  });

  it('tells the two directions of a foreign key apart', async () => {
    const missing = await refusal(`insert into child values (2, 99, 1)`);
    expect(missing.code).toBe('23503');
    expect(fromDatabaseError(missing, 'x.save_failed').message).toBe('That no longer exists.');

    const inUse = await refusal(`delete from parent where id = 1`);
    expect(inUse.code).toBe('23503');
    expect(fromDatabaseError(inUse, 'x.remove_failed').message).toBe("That's still in use, so it can't be removed.");
  });

  it('turns a check constraint into "That value isn\'t allowed."', async () => {
    const error = await refusal(`insert into child values (3, 1, 0)`);
    expect(error.code).toBe('23514');
    expect(fromDatabaseError(error, 'x.save_failed').message).toBe("That value isn't allowed.");
  });

  it('turns row security and missing grants into "You don\'t have access to that."', async () => {
    const denied = await refusal(`set local role anon; select 1 from parent`);
    await pg.query('reset role');
    expect(denied.code).toBe('42501');
    expect(fromDatabaseError(denied, 'x.read_failed').message).toBe("You don't have access to that.");

    // Row security through the API, as a signed-in visitor writing a row they may not.
    if (!ANON_KEY) throw new Error('SUPABASE_ANON_KEY must be set.');
    const visitor = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await visitor.auth.signInAnonymously();
    if (signInError) throw signInError;
    const { error } = await visitor.from('organizations').insert({ name: 'Not mine' } as never);
    expect(error?.code).toBe('42501');
    expect(fromDatabaseError(error, 'x.save_failed').message).toBe("You don't have access to that.");
  });

  it('passes a sentence a database function raised on purpose through unchanged', async () => {
    const plain = await refusal(`do $$ begin raise exception 'That job is already finished.'; end $$`);
    expect(plain.code).toBe('P0001');
    expect(fromDatabaseError(plain, 'work.move_failed').message).toBe('That job is already finished.');

    // Raised on purpose under a standard code: still the function's own sentence.
    const role = await refusal(`do $$ begin raise exception 'Your role cannot manage forms.' using errcode = '42501'; end $$`);
    expect(fromDatabaseError(role, 'forms.failed').message).toBe('Your role cannot manage forms.');
    const own = await refusal(`do $$ begin raise exception 'Choose a stage first.' using errcode = 'GD001'; end $$`);
    expect(fromDatabaseError(own, 'work.move_failed').message).toBe('Choose a stage first.');
  });

  it('never shows an unknown failure, and keeps it in the log', async () => {
    const error = await refusal(`select 'not-a-number'::int`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const translated = fromDatabaseError(error, 'x.read_failed');
    expect(translated.message).toBe('Something went wrong. Try again.');
    expect(translated.code).toBe('x.read_failed');
    expect(translated.cause).toBe(error);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('invalid input syntax'));

    expect(fromDatabaseError({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }, 'x').message).toBe('Something went wrong. Try again.');
    expect(fromDatabaseError(null, 'x').message).toBe('Something went wrong. Try again.');
    log.mockRestore();
  });
});
