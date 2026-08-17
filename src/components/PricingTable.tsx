import { useState } from 'preact/hooks';
import { ApiError, apiSend } from '~/lib/client';
import {
  type BillingInterval,
  type Plan,
  type PlanId,
  BUSINESS,
  CURRENCY_SYMBOL,
  formatPrice,
  monthlyEquivalent,
} from '~/lib/plans';

interface Props {
  plans: Plan[];
  currentPlan: PlanId;
  /** Дали Stripe е настроен на сървъра. */
  billingEnabled: boolean;
  signedIn: boolean;
}

export default function PricingTable({ plans, currentPlan, billingEnabled, signedIn }: Props) {
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState('');

  async function choose(plan: Plan) {
    if (plan.id === 'free') {
      window.location.href = signedIn ? '/app' : '/register';
      return;
    }
    if (!signedIn) {
      window.location.href = `/register?next=${encodeURIComponent('/pricing')}`;
      return;
    }
    if (!billingEnabled) {
      setError('Плащанията още не са включени на този сървър.');
      return;
    }

    setBusy(plan.id);
    setError('');
    try {
      const { url } = await apiSend<{ url: string }>('/api/billing/checkout', 'POST', {
        plan: plan.id,
        interval,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Плащането не можа да започне.');
      setBusy(null);
    }
  }

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <div class="interval-switch" role="group" aria-label="Период на плащане">
          <button class={interval === 'month' ? 'on' : ''} onClick={() => setInterval('month')}>
            Месечно
          </button>
          <button class={interval === 'year' ? 'on' : ''} onClick={() => setInterval('year')}>
            Годишно<span class="save-badge">2 месеца без пари</span>
          </button>
        </div>
      </div>

      {error && (
        <div class="auth-message bad" style={{ maxWidth: '520px', margin: '22px auto 0' }}>
          {error}
        </div>
      )}

      <div class="plans">
        {plans.map((plan) => {
          const price = interval === 'year' ? plan.yearly : plan.monthly;
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id} class={`plan ${plan.featured ? 'featured' : ''}`}>
              {plan.featured && <div class="plan-flag">Най-често избиран</div>}
              <h2>{plan.name}</h2>
              <p class="tagline">{plan.tagline}</p>

              <div class="plan-price">
                <span class="amount">{formatPrice(price ?? 0)}</span>
                <span class="per">{price === null ? '' : interval === 'year' ? '/ година' : '/ месец'}</span>
              </div>
              <div class="plan-note">
                {price === null
                  ? 'Без карта, без срок.'
                  : interval === 'year'
                    ? `Излиза ${monthlyEquivalent(plan)} на месец`
                    : 'Спираш когато решиш'}
              </div>

              <ul>
                {plan.features.map((f) => (
                  <li key={f}>
                    <span class="tick">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div class="grow" />

              {isCurrent ? (
                <div class="plan-current">Текущият ти план</div>
              ) : (
                <button
                  class={`btn plan-cta ${plan.featured ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => choose(plan)}
                  disabled={busy !== null}
                >
                  {busy === plan.id
                    ? 'Момент…'
                    : plan.id === 'free'
                      ? 'Започни безплатно'
                      : `Вземи ${plan.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Бизнес планът е отделно, защото не се купува с бутон: цената е на място и
          върви по фактура. Карта с „Вземи“ би обещала поток, който още го няма. */}
      <div class="plan-card business">
        <div class="plan-name">{BUSINESS.name}</div>
        <div class="plan-price">
          <span class="amount">
            {CURRENCY_SYMBOL}
            {(BUSINESS.perSeatMonthly / 100).toFixed(0)}
          </span>
          <span class="per">/ място на месец</span>
        </div>
        <div class="plan-tagline">
          {BUSINESS.tagline} Минимум {BUSINESS.minSeats} места.
        </div>
        <ul class="plan-features">
          {BUSINESS.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div class="grow" />
        <a class="btn plan-cta btn-ghost" href="/contact?tema=бизнес">
          Пиши ни
        </a>
      </div>
    </>
  );
}
