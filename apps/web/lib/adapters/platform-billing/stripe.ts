import type {
  CheckoutSessionRequest,
  CheckoutSessionStarted,
  PlatformBillingCustomer,
  PlatformBillingEnvironment,
  PlatformBillingProvider,
  PortalSessionStarted,
  ProvisionedPrice,
} from './index';

/**
 * Stripe, behind the capability its interface names — GOLD's own Stripe Billing relationship
 * with an organization, never a tenant's connected account. See `./index.ts` for why this is a
 * separate capability from `lib/adapters/payments/stripe.ts` rather than an extra method on it.
 *
 * **No SDK**, the same decision `lib/adapters/payments/stripe.ts` already made and for the same
 * reason: one HTTPS call and a form encoding, both stable and specified, is what this needs.
 *
 * **Only the outbound half is here.** Being told what happened to a subscription is webhook
 * ingress and lives in `apps/api` (D2, D26) — its own destination, its own signing secret, its
 * own Postgres role, entirely separate from the tenant-commerce webhook.
 */

const API = 'https://api.stripe.com/v1';

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function post<T>(path: string, secret: string, idempotencyKey: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: form(body),
  });

  if (!response.ok) {
    throw new Error(`stripe refused the request (${response.status}): ${path}`);
  }

  return (await response.json()) as T;
}

export function stripePlatformBillingProvider(config: { secret: string }): PlatformBillingProvider {
  // A live secret key always starts `sk_live_`; every other shape (`sk_test_`, a restricted
  // key, anything else this deployment might be handed) is treated as sandbox rather than
  // guessed at — the safer default when the two are confused is never charging for real (Phase 16).
  const environment: PlatformBillingEnvironment = config.secret.startsWith('sk_live_') ? 'live' : 'sandbox';

  return {
    name: 'stripe',
    environment,

    async ensureCustomer(input): Promise<PlatformBillingCustomer> {
      const body: Record<string, string> = {
        'metadata[organization_id]': input.organizationId,
      };
      if (input.email) body.email = input.email;
      if (input.name) body.name = input.name;

      const customer = await post<{ id?: string }>(
        '/customers',
        config.secret,
        // Stable per organization: a network retry of this exact call within Stripe's own
        // idempotency window reuses the same Customer rather than creating a second one. The
        // caller's own unique (organization_id, environment) row is what makes a call *after*
        // the window a no-op too.
        `platform-billing-customer:${input.organizationId}`,
        body,
      );

      if (!customer.id) {
        throw new Error('stripe created a customer without naming one');
      }

      return { customerId: customer.id };
    },

    async createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSessionStarted> {
      if (input.lineItems.length === 0) {
        throw new Error('stripe checkout session requires at least one line item');
      }
      const lineItemFields: Record<string, string> = {};
      input.lineItems.forEach((item, index) => {
        lineItemFields[`line_items[${index}][price]`] = item.priceId;
        lineItemFields[`line_items[${index}][quantity]`] = String(item.quantity);
      });

      const session = await post<{ id?: string; url?: string }>(
        '/checkout/sessions',
        config.secret,
        input.requestId,
        {
          mode: 'subscription',
          customer: input.customerId,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...lineItemFields,
          // Our own correlation token, handed out and (for the browser's own return trip only —
          // never trusted as payment proof, Phase 7) handed back.
          client_reference_id: input.organizationId,
          'metadata[organization_id]': input.organizationId,
        },
      );

      if (!session.id || !session.url) {
        throw new Error('stripe returned no checkout session to send the organization to');
      }

      return { url: session.url, providerReference: session.id };
    },

    async createPortalSession(input): Promise<PortalSessionStarted> {
      const session = await post<{ url?: string }>(
        '/billing_portal/sessions',
        config.secret,
        // Opening a portal session has no financial side effect, so an idempotency key only
        // needs to survive one accidental double-submit rather than correlate a durable row.
        `platform-billing-portal:${input.customerId}:${Date.now()}`,
        {
          customer: input.customerId,
          return_url: input.returnUrl,
        },
      );

      if (!session.url) {
        throw new Error('stripe returned no portal session');
      }

      return { url: session.url };
    },

    async createPrice(input): Promise<ProvisionedPrice> {
      const product = await post<{ id?: string }>(
        '/products',
        config.secret,
        input.productIdempotencyKey,
        {
          name: input.planLabel,
          'metadata[plan_key]': input.planKey,
        },
      );
      if (!product.id) {
        throw new Error('stripe created a product without naming one');
      }

      const priceBody: Record<string, string> = {
        product: product.id,
        currency: input.currency.toLowerCase(),
        unit_amount: String(input.amountMinor),
      };
      if (input.billingInterval !== 'one_time') {
        priceBody['recurring[interval]'] = input.billingInterval;
      }

      const price = await post<{ id?: string }>('/prices', config.secret, input.priceIdempotencyKey, priceBody);
      if (!price.id) {
        throw new Error('stripe created a price without naming one');
      }

      return { productId: product.id, priceId: price.id };
    },
  };
}
