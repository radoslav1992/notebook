/**
 * Единственото място, което говори със Stripe.
 *
 * Обикновен `fetch` вместо SDK: Stripe API е form-encoded и това, което ни
 * трябва, са четири заявки и проверка на подпис. Така няма и зависимост, която
 * да се държи различно във Workers.
 */

const BASE = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

export interface StripeOptions {
  secretKey: string;
  /** Различен адрес — за тестове. */
  host?: string;
}

export class Stripe {
  #key: string;
  #base: string;

  constructor(opts: StripeOptions) {
    if (!opts.secretKey) throw new StripeError(500, 'Липсва Stripe секретен ключ.');
    this.#key = opts.secretKey;
    this.#base = opts.host ? `${opts.host.replace(/\/+$/, '')}/v1` : BASE;
  }

  async #post<T>(path: string, form: Record<string, string | undefined>): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined) body.set(k, v);
    }
    const res = await fetch(`${this.#base}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#key}`,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': '2025-03-31.basil',
      },
      body,
    });
    return this.#unwrap<T>(res);
  }

  async #get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.#base}/${path}`, {
      headers: {
        authorization: `Bearer ${this.#key}`,
        'stripe-version': '2025-03-31.basil',
      },
    });
    return this.#unwrap<T>(res);
  }

  async #unwrap<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let message = `Stripe отговори с ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = body.error.message;
      } catch {
        /* без тяло */
      }
      throw new StripeError(res.status, message);
    }
    return (await res.json()) as T;
  }

  /** Клиент, свързан с наш потребител — `metadata.userId` затваря кръга. */
  async createCustomer(input: {
    email?: string | null;
    name?: string;
    userId: string;
  }): Promise<{ id: string }> {
    return this.#post<{ id: string }>('customers', {
      email: input.email ?? undefined,
      name: input.name,
      'metadata[userId]': input.userId,
    });
  }

  /** Страницата за плащане. Връща адрес, към който препращаме браузъра. */
  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    userId: string;
    locale?: string;
    trialDays?: number;
  }): Promise<{ id: string; url: string }> {
    return this.#post<{ id: string; url: string }>('checkout/sessions', {
      mode: 'subscription',
      customer: input.customerId,
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.userId,
      'subscription_data[metadata][userId]': input.userId,
      'metadata[userId]': input.userId,
      locale: input.locale ?? 'bg',
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      'automatic_tax[enabled]': 'true',
      'customer_update[address]': 'auto',
      'customer_update[name]': 'auto',
      ...(input.trialDays
        ? { 'subscription_data[trial_period_days]': String(input.trialDays) }
        : {}),
    });
  }

  /** Порталът, в който човек сменя картата си или спира абонамента. */
  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    locale?: string;
  }): Promise<{ url: string }> {
    return this.#post<{ url: string }>('billing_portal/sessions', {
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: input.locale ?? 'bg',
    });
  }

  async getSubscription(id: string): Promise<StripeSubscription> {
    return this.#get<StripeSubscription>(`subscriptions/${id}`);
  }

  async getCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    return this.#get<StripeCheckoutSession>(`checkout/sessions/${id}`);
  }

  /**
   * Проверява подписа на webhook.
   *
   * Без това всеки може да ни прати „платено“ и да си вземе платен план, така
   * че webhook-ът не прави нищо, преди подписът да мине.
   */
  static async verifyWebhook(input: {
    payload: string;
    signatureHeader: string | null;
    secret: string;
    toleranceSeconds?: number;
  }): Promise<StripeEvent> {
    const header = input.signatureHeader;
    if (!header) throw new StripeError(400, 'Липсва Stripe-Signature.');

    let timestamp = '';
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const [k, v] = part.split('=', 2);
      if (k?.trim() === 't' && v) timestamp = v.trim();
      if (k?.trim() === 'v1' && v) signatures.push(v.trim());
    }
    if (!timestamp || signatures.length === 0) {
      throw new StripeError(400, 'Stripe-Signature е с неочакван вид.');
    }

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > (input.toleranceSeconds ?? 300)) {
      throw new StripeError(400, 'Подписът е твърде стар.');
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${input.payload}`),
    );
    const expected = [...new Uint8Array(mac)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const ok = signatures.some((sig) => timingSafeEqual(sig, expected));
    if (!ok) throw new StripeError(400, 'Подписът не съвпада.');

    return JSON.parse(input.payload) as StripeEvent;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Малкото от типовете на Stripe, което ползваме ───────────────────────── */

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end?: boolean;
  /** Секунди; в новите версии живее в items.data[].current_period_end. */
  current_period_end?: number;
  items?: {
    data?: {
      current_period_end?: number;
      price?: { id?: string; recurring?: { interval?: string } };
    }[];
  };
  metadata?: Record<string, string>;
}

export interface StripeCheckoutSession {
  id: string;
  customer?: string;
  subscription?: string;
  client_reference_id?: string;
  metadata?: Record<string, string>;
}

/** Кое price ID стои зад абонамента. */
export function priceIdOf(sub: StripeSubscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id;
}

/** Краят на текущия период в милисекунди, откъдето и да идва. */
export function periodEndMs(sub: StripeSubscription): number | null {
  const seconds = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  return typeof seconds === 'number' ? seconds * 1000 : null;
}

export function intervalOf(sub: StripeSubscription): 'month' | 'year' {
  return sub.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'year' : 'month';
}
