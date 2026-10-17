import type {
  ConnectedAccount,
  PaymentProvider,
  PaymentRequest,
  PaymentRequested,
} from './index';

/**
 * Stripe, behind the capability its interface names.
 *
 * **The only file in this repository that knows Stripe exists.** Everything above it asks to
 * charge a card; this is the one place that knows how, and the no-vendor-SDK-in-domain rule is the test that keeps it so.
 *
 * **No SDK, and that is a decision rather than an omission.** What this needs is one HTTPS call
 * and a form encoding, both stable and specified. An SDK would add a dependency whose
 * transitive surface nothing here uses, and it would want a network at import time.
 *
 * **Only the outbound half is here.** Verifying what Stripe sends back is webhook ingress and
 * lives in `apps/api` — so this file makes a request and never reads a callback, and
 * there is exactly one HMAC implementation in the repository rather than two.
 */

const API = 'https://api.stripe.com/v1';
const CONNECT = 'https://connect.stripe.com';

/** Stripe's form encoding for nested objects: `metadata[request_id]=…`. */
function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export function stripePaymentProvider(config: {
  secret: string;
  clientId: string;
}): PaymentProvider {
  return {
    name: 'stripe',

    connectUrl(input) {
      // Standard accounts: the business onboards on Stripe, keeps its own dashboard, and is
      // the merchant of record. `read_write` is what lets this platform create a charge on
      // their behalf; it does not give it their keys, and they can revoke it themselves.
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: 'read_write',
        state: input.state,
        redirect_uri: input.returnUrl,
      });
      return `${CONNECT}/oauth/authorize?${query.toString()}`;
    },

    async completeConnection(input): Promise<ConnectedAccount> {
      const response = await fetch(`${CONNECT}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'authorization_code',
          code: input.code,
          // The platform's own key, which is what this exchange authenticates. The business's
          // key is never seen here and never stored anywhere.
          client_secret: config.secret,
        }),
      });

      if (!response.ok) {
        throw new Error(`stripe would not complete the connection (${response.status})`);
      }

      const body = (await response.json()) as { stripe_user_id?: string };
      if (!body.stripe_user_id) {
        throw new Error('stripe completed the connection without naming an account');
      }

      return { accountId: body.stripe_user_id };
    },

    async request(input: PaymentRequest): Promise<PaymentRequested> {
      const response = await fetch(`${API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // **A direct charge, and this header is the whole of it.** The session is created on
          // the business's own account, so the money is theirs and never passes through a
          // balance of ours — which is what keeps this platform out of being a money
          // transmitter. Without this header the charge would land on the platform.
          'Stripe-Account': input.account.accountId,
          // Our own correlation token, so a retried request produces one session rather than
          // two. The same discipline the database uses one layer down.
          'Idempotency-Key': input.requestId,
        },
        body: form({
          mode: 'payment',
          success_url: input.returnUrl,
          cancel_url: input.returnUrl,
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': input.currency.toLowerCase(),
          'line_items[0][price_data][unit_amount]': String(input.amountMinor),
          'line_items[0][price_data][product_data][name]': input.description,
          // Handed out and handed back. It is a uuid we generated, and the row it names is
          // what carries the organization, the invoice and the currency.
          'metadata[request_id]': input.requestId,
          client_reference_id: input.requestId,
        }),
      });

      if (!response.ok) {
        throw new Error(`stripe refused the request (${response.status})`);
      }

      const session = (await response.json()) as { id?: string; url?: string };
      if (!session.id || !session.url) {
        throw new Error('stripe returned no session to send the payer to');
      }

      return { providerReference: session.id, payUrl: session.url };
    },

  };
}
