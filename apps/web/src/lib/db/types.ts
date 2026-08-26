import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * The database handle a domain function operates on.
 *
 * Domain functions take this as an argument rather than constructing it, so the same
 * function is callable from a server action, a route handler, or a test without any of
 * those becoming a special case. It is always a client bound to a caller's JWT — never
 * service-role — because RLS is the tenant boundary, not an application filter.
 *
 * The `Database` generic comes from `database.types.ts`, which is generated from the live
 * schema by `pnpm db:types` and checked in (constraints.md D15). Without it every `select`
 * returns `any` and a column renamed in a migration is a runtime error in whichever screen
 * happens to read it first. With it, that rename is a typecheck failure.
 */
export type Db = SupabaseClient<Database>;

export type { Database };
