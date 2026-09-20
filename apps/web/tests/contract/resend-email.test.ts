import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformEmailSender } from '@/lib/adapters/email/registry';
import { resendPlatformEmailSender } from '@/lib/adapters/email/resend';

/**
 * GOLD's own transactional email (invitations), offline: what the adapter sends the vendor and
 * what it refuses to say when the vendor refuses it. `fetch` is replaced, so nothing is sent.
 */

const KEY = 're_contract_suite_key';
const sender = resendPlatformEmailSender({ apiKey: KEY, sender: 'GOLD <hello@gold.example>' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sending one message', () => {
  it('posts the four fields, and only those, to the vendor with the key as a bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    });

    await sender.send({ to: 'person@example.test', subject: 'You are invited', text: 'Hello' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'GOLD <hello@gold.example>',
      to: 'person@example.test',
      subject: 'You are invited',
      text: 'Hello',
    });
  });

  it('fails with the status and never repeats the key', async () => {
    vi.stubGlobal('fetch', async () => new Response(`invalid key ${KEY}`, { status: 403 }));

    const failure = await sender.send({ to: 'a@example.test', subject: 's', text: 't' }).catch((error: Error) => error);

    expect((failure as Error).message).toContain('403');
    expect((failure as Error).message).not.toContain(KEY);
  });
});

describe('a deployment that has not configured it', () => {
  it('has no sender at all, so nothing can be sent by accident', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('PLATFORM_EMAIL_FROM_ADDRESS', '');

    await expect(platformEmailSender()).resolves.toBeNull();
  });
});
