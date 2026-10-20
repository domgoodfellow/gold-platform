import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformEmailSender } from '@/lib/adapters/email/registry';

/**
 * GOLD's own transactional email (invitations), offline: what this relay sends `apps/api` and
 * what a deployment with no API configured does instead. `fetch` is replaced, so nothing leaves
 * the process and no vendor is named here at all — `apps/api`'s own suite covers the Resend call.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a deployment with no apps/api configured', () => {
  it('has no sender at all, so nothing can be sent by accident', async () => {
    vi.stubEnv('GOLD_API_URL', '');

    await expect(platformEmailSender({ token: 't' })).resolves.toBeNull();
  });
});

describe('a deployment with apps/api configured', () => {
  it('relays the invitation, the link and the caller’s own token, and reads back the receipt', async () => {
    vi.stubEnv('GOLD_API_URL', 'https://api.example.test');
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ sent: true, external_id: 're_abc123' }), { status: 200 });
    });

    const sender = await platformEmailSender({ token: 'caller-token' });
    expect(sender).not.toBeNull();

    const receipt = await sender!.sendInvitationEmail({
      organizationId: 'org-1',
      invitationId: 'inv-1',
      link: 'https://app.test/organizations/accept-invite/tok',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.test/invitations/email');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer caller-token' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      organization_id: 'org-1',
      invitation_id: 'inv-1',
      link: 'https://app.test/organizations/accept-invite/tok',
    });
    expect(receipt).toEqual({ sent: true, externalId: 're_abc123', detail: null });
  });

  it('never carries a subject or a body — only an invitation id and the link', async () => {
    vi.stubEnv('GOLD_API_URL', 'https://api.example.test');
    let sentBody: unknown;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ sent: false, external_id: null }), { status: 200 });
    });

    const sender = await platformEmailSender({ token: 't' });
    await sender!.sendInvitationEmail({ organizationId: 'o', invitationId: 'i', link: 'https://x.test/y' });

    expect(Object.keys(sentBody as object).sort()).toEqual(['invitation_id', 'link', 'organization_id']);
  });

  it('surfaces a refusal from apps/api as sent: false material to the caller, not a thrown error', async () => {
    vi.stubEnv('GOLD_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sent: false, external_id: null, detail: 'GildOps’ invitation email is not set up on this deployment yet.' }), { status: 200 }));

    const sender = await platformEmailSender({ token: 't' });
    const receipt = await sender!.sendInvitationEmail({ organizationId: 'o', invitationId: 'i', link: 'https://x.test/y' });

    // The reason travels with the refusal (Phase 3B), so the manager is told why it was not emailed.
    expect(receipt).toEqual({ sent: false, externalId: null, detail: 'GildOps’ invitation email is not set up on this deployment yet.' });
  });
});
