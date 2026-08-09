/**
 * Fake Stripe API — customers, checkout sessions, portal, subscriptions,
 * plus a helper that signs webhook payloads the way Stripe does.
 */
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = Number(process.env.MOCK_STRIPE_PORT || 8789);
export const WEBHOOK_SECRET = 'whsec_test_secret';

const calls = [];
let counter = 0;
const subscriptions = new Map();

function form(raw) {
  return Object.fromEntries(new URLSearchParams(raw));
}

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const url = req.url ?? '';
  const body = form(raw);
  calls.push({ url, method: req.method, body, auth: req.headers.authorization });

  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.startsWith('/__calls')) return send(200, { calls, subscriptions: [...subscriptions.values()] });
  if (url.startsWith('/__reset')) {
    calls.length = 0;
    subscriptions.clear();
    return send(200, { ok: true });
  }

  if (req.headers.authorization !== 'Bearer sk_test_mock') {
    return send(401, { error: { message: 'Invalid API Key provided' } });
  }

  if (url === '/v1/customers') {
    counter += 1;
    return send(200, { id: `cus_mock${counter}`, email: body.email, metadata: { userId: body['metadata[userId]'] } });
  }

  if (url === '/v1/checkout/sessions') {
    counter += 1;
    const id = `cs_mock${counter}`;
    const subId = `sub_mock${counter}`;
    // Record what a completed checkout would look like, so the test can
    // fire the matching webhook.
    subscriptions.set(subId, {
      id: subId,
      status: 'active',
      customer: body.customer,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            price: { id: body['line_items[0][price]'], recurring: { interval: 'month' } },
          },
        ],
      },
      metadata: { userId: body['subscription_data[metadata][userId]'] },
    });
    return send(200, {
      id,
      url: `https://checkout.stripe.test/${id}`,
      customer: body.customer,
      subscription: subId,
      client_reference_id: body.client_reference_id,
      metadata: { userId: body['metadata[userId]'] },
    });
  }

  if (url === '/v1/billing_portal/sessions') {
    return send(200, { url: `https://portal.stripe.test/${body.customer}` });
  }

  const sub = /^\/v1\/subscriptions\/(.+)$/.exec(url);
  if (sub) {
    const found = subscriptions.get(sub[1]);
    if (!found) return send(404, { error: { message: 'No such subscription' } });
    return send(200, found);
  }

  return send(404, { error: { message: 'unhandled: ' + url } });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock stripe on ${PORT}`));

/** Same signature scheme Stripe uses, so verifyWebhook is genuinely exercised. */
export function signPayload(payload, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}
