import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripePaymentProvider } from '@/lib/adapters/payments/stripe';

/**
 * The card-payment adapter's contract with Stripe, offline.
 *
 * `portal-payments.test.ts` proves what GOLD does with a payment against real Postgres; nothing
 * proved what this adapter actually *sends* Stripe, and that is where money is mis-stated: an
 * amount in the wrong unit, a session made on the wrong account, a retry that charges twice. `fetch`
 * is replaced, so no test here can reach a vendor, and each asserts the address it was aimed at.
 */

const SECRET = 'sk_test_contract_suite';
const provider = stripePaymentProvider({ secret: SECRET, clientId: 'ca_contract_suite' });

type Call = { url: string; init: RequestInit };
function stubFetch(reply: Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply;
  });
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call) => new URLSearchParams(String(call.init.body));

afterEach(() => vi.unstubAllGlobals());

const REQUEST = {
  account: { accountId: 'acct_tenant' },
  requestId: 'req-123',
  amountMinor: 12_345,
  currency: 'EUR',
  description: 'Invoice 42',
  returnUrl: 'https://gold.example/portal/payment-return',
};

describe('asking a connected account to be paid', () => {
  it("creates a checkout session on the tenant's own account, idempotently, in minor units", async () => {
    const calls = stubFetch(json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));

    await provider.request(REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: `Bearer ${SECRET}`,
      'Stripe-Account': 'acct_tenant',
      'Idempotency-Key': 'req-123',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = bodyOf(calls[0]);
    expect(body.get('mode')).toBe('payment');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('12345');
    expect(body.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(body.get('client_reference_id')).toBe('req-123');
    expect(body.get('metadata[request_id]')).toBe('req-123');
  });

  it('hands back the session and where to send the payer', async () => {
    stubFetch(json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));

    await expect(provider.request(REQUEST)).resolves.toEqual({
      providerReference: 'cs_1',
      payUrl: 'https://checkout.stripe.com/c/pay/cs_1',
    });
  });

  it('refuses a reply that names no session, rather than sending the payer nowhere', async () => {
    stubFetch(json({ id: 'cs_1' }));

    await expect(provider.request(REQUEST)).rejects.toThrow(/no session/);
  });

  it("fails with the status and never repeats the secret or the vendor's body", async () => {
    stubFetch(json({ error: { message: `bad key ${SECRET}` } }, 402));

    const failure = await provider.request(REQUEST).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('402');
    expect((failure as Error).message).not.toContain(SECRET);
  });
});

describe("connecting a tenant's Stripe account", () => {
  it('puts the client id, and never the secret, in the address the browser is sent to', () => {
    const url = new URL(provider.connectUrl({ state: 'state-1', returnUrl: 'https://gold.example/back' }));

    expect(url.origin + url.pathname).toBe('https://connect.stripe.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ca_contract_suite');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.toString()).not.toContain(SECRET);
  });

  it('exchanges the code server-side and returns only the account it names', async () => {
    const calls = stubFetch(json({ stripe_user_id: 'acct_new', access_token: 'sk_live_must_not_escape' }));

    const account = await provider.completeConnection({ code: 'ac_1', returnUrl: 'https://gold.example/back' });

    expect(calls[0].url).toBe('https://connect.stripe.com/oauth/token');
    expect(bodyOf(calls[0]).get('grant_type')).toBe('authorization_code');
    expect(bodyOf(calls[0]).get('code')).toBe('ac_1');
    expect(bodyOf(calls[0]).get('client_secret')).toBe(SECRET);
    expect(account).toEqual({ accountId: 'acct_new' });
  });

  it('refuses a completed connection that names no account', async () => {
    stubFetch(json({}));

    await expect(provider.completeConnection({ code: 'ac_1', returnUrl: 'https://gold.example/back' })).rejects.toThrow(
      /without naming an account/,
    );
  });
});
