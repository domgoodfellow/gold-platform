import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The database handle a domain function operates on.
 *
 * Domain functions take this as an argument rather than constructing it, so the same
 * function is callable from a server action, a route handler, or a test without any of
 * those becoming a special case. It is always a client bound to a caller's JWT — never
 * service-role — because RLS is the tenant boundary, not an application filter.
 */
export type Db = SupabaseClient;
