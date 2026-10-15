import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { completeOAuth } from '@/lib/domain/integrations/oauth';
import { OAUTH_NONCE_COOKIE } from '@/lib/domain/integrations/oauth-cookie';

const OAUTH_OWN = new Set(['code', 'state', 'error', 'error_description', 'error_uri']);

/**
 * Whatever else a vendor put on its redirect, relayed untouched and bounded. Not understood and not
 * trusted here: the API hands it to the one provider that asked for it, which proves what it
 * depends on itself (a vendor that returns an installation id is asked which installations the
 * signed-in person can actually reach).
 */
function relayedParameters(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()]
      .filter(([name]) => !OAUTH_OWN.has(name))
      .slice(0, 10)
      .map(([name, value]) => [name.slice(0, 40), value.slice(0, 200)]),
  );
}

/**
 * Where every vendor sends a person back to. It trusts nothing in the URL: the `state` names the
 * business, and the API verifies its signature, its age, that it belongs to this signed-in person,
 * and that its nonce matches the cookie only this browser holds. A vendor's refusal (the person
 * pressed Cancel) is shown as the vendor's own words, never as a crash.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const nonce = jar.get(OAUTH_NONCE_COOKIE)?.value ?? '';

  // Only to choose where to show a failure: the state is not trusted here, and a value that is not
  // a UUID is ignored. The API is what verifies it before anything is connected.
  const organizationHint = (() => {
    try {
      const body = (url.searchParams.get('state') ?? '').split('.')[0] ?? '';
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { org?: unknown };
      return typeof claims.org === 'string' && /^[0-9a-f-]{36}$/i.test(claims.org) ? claims.org : null;
    } catch {
      return null;
    }
  })();

  const failed = (message: string) => {
    const target = new URL(
      organizationHint ? `/organizations/${organizationHint}/settings/connections` : '/organizations',
      request.url,
    );
    target.searchParams.set('catalog', 'open');
    target.searchParams.set('oauth_error', message);
    const response = NextResponse.redirect(target);
    response.cookies.delete({ name: OAUTH_NONCE_COOKIE, path: '/connect/oauth' });
    return response;
  };

  const denied = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (denied) return failed(`The provider did not connect: ${denied.slice(0, 200)}`);

  try {
    const done = await completeOAuth(await getDb(), {
      code: url.searchParams.get('code') ?? '',
      state: url.searchParams.get('state') ?? '',
      nonce,
      extra: relayedParameters(url),
    });
    const target = new URL(`/organizations/${done.organization_id}/settings/connections/${done.connection_id}`, request.url);
    target.searchParams.set('connected', '1');
    const response = NextResponse.redirect(target);
    response.cookies.delete({ name: OAUTH_NONCE_COOKIE, path: '/connect/oauth' });
    return response;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return failed(error.message);
  }
}
