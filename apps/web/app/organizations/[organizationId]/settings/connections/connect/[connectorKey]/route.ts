import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { getConnector } from '@/lib/domain/integrations/connectors';
import { beginOAuth } from '@/lib/domain/integrations/oauth';
import { OAUTH_NONCE_COOKIE } from '@/lib/domain/integrations/oauth-cookie';
import { requireOrganization } from '@/lib/route/organization';

/**
 * Start a vendor sign-in. Every check that matters — that this person may manage integrations for
 * this business, that the connector exists and is not planned — is `apps/api`'s, proved through the
 * caller's own token; this only turns its answer into a redirect. The one-time value goes in a
 * cookie the callback must present, so a link cannot be completed in a different browser.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<'/organizations/[organizationId]/settings/connections/connect/[connectorKey]'>,
) {
  const { organizationId, connectorKey } = await params;
  await requireOrganization(organizationId);
  const home = new URL(`/organizations/${organizationId}/settings/connections/apps`, request.url);
  const connectionId = new URL(request.url).searchParams.get('connection') ?? undefined;

  try {
    // An MCP server is added with its address on its own screen; there is no vendor sign-in to start.
    const connector = await getConnector(await getDb(), connectorKey);
    if (connector?.connectionMethod === 'mcp') {
      return NextResponse.redirect(new URL(`/organizations/${organizationId}/settings/connections/mcp`, request.url));
    }
    const { url, nonce } = await beginOAuth(await getDb(), { organizationId, connectorKey, connectionId });
    const response = NextResponse.redirect(url);
    response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/connect/oauth',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    home.searchParams.set('oauth_error', error.message);
    return NextResponse.redirect(home);
  }
}
