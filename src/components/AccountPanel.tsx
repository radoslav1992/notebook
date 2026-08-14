import { useState } from 'preact/hooks';
import { ApiError, apiSend } from '~/lib/client';
import { formatPrice, PLANS, type PlanId } from '~/lib/plans';
import type { User } from '~/lib/types';

export interface SubscriptionView {
  plan: PlanId;
  planName: string;
  status: string;
  interval: 'month' | 'year';
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  limits: {
    notebooks: number | null;
    questionsPerMonth: number;
    audioPerMonth: number;
    audioMinutes: number;
    proModel: boolean;
  };
}

export interface UsageView {
  period: string;
  questions: number;
  audio: number;
  notebooks: number;
}

interface Props {
  user: User;
  subscription: SubscriptionView;
  usage: UsageView;
  billingEnabled: boolean;
  googleEnabled: boolean;
}

export default function AccountPanel({
  user,
  subscription,
  usage,
  billingEnabled,
  googleEnabled,
}: Props) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [devLink, setDevLink] = useState('');

  async function openPortal() {
    setBusy('portal');
    setError('');
    try {
      const { url } = await apiSend<{ url: string }>('/api/billing/portal', 'POST');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Порталът не се отвори.');
      setBusy('');
    }
  }

  async function resendVerification() {
    setBusy('verify');
    setError('');
    setNote('');
    setDevLink('');
    try {
      const res = await apiSend<{ emailSent: boolean; verifyLink?: string }>(
        '/api/auth/verify',
        'PATCH',
      );
      setNote(res.emailSent ? 'Писмото е изпратено.' : 'Няма настроен доставчик на писма.');
      if (res.verifyLink) setDevLink(res.verifyLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Писмото не беше изпратено.');
    } finally {
      setBusy('');
    }
  }

  async function deleteAccount() {
    // Необратимо е и трие чужди неща (файлове, вектори, абонамент), затова се
    // потвърждава с нещо, което не се натиска по невнимание.
    const hasPassword = user.hasPassword;
    const answer = window.prompt(
      hasPassword
        ? 'Изтриването е необратимо: тетрадките, източниците, разговорите и аудиото изчезват, а абонаментът се спира.\n\nВъведи паролата си, за да потвърдиш:'
        : 'Изтриването е необратимо: тетрадките, източниците, разговорите и аудиото изчезват, а абонаментът се спира.\n\nНапиши ИЗТРИЙ, за да потвърдиш:',
    );
    if (!answer) return;

    setBusy('delete');
    setError('');
    try {
      await apiSend('/api/me', 'DELETE', hasPassword ? { password: answer } : { confirm: answer });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Профилът не беше изтрит.');
      setBusy('');
    }
  }

  async function logout() {
    setBusy('logout');
    try {
      await apiSend('/api/auth/logout', 'POST');
      window.location.href = '/';
    } catch {
      setBusy('');
    }
  }

  const plan = PLANS[subscription.plan];
  const price =
    subscription.interval === 'year' ? plan.yearly : plan.monthly;
  // Датата важи само докато планът е платен: след падане на безплатния план
  // старият край на период не значи нищо.
  const renews =
    subscription.plan !== 'free' && subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString('bg-BG', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  return (
    <>
      {/* ── Профил ─────────────────────────────────────────────────────── */}
      <div class="settings-card">
        <div class="settings-section">Профил</div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">{user.email}</div>
            <div class="setting-hint">
              {user.emailVerified ? 'Имейлът е потвърден.' : 'Имейлът още не е потвърден.'}
              {user.hasPassword && user.hasGoogle
                ? ' Влизаш с парола или с Google.'
                : user.hasGoogle
                  ? ' Влизаш с Google.'
                  : ' Влизаш с парола.'}
            </div>
          </div>
          {!user.emailVerified && (
            <button class="btn btn-quiet" onClick={resendVerification} disabled={busy === 'verify'}>
              {busy === 'verify' ? 'Пращам…' : 'Изпрати наново'}
            </button>
          )}
        </div>

        {!user.hasGoogle && googleEnabled && (
          <div class="setting">
            <div class="grow">
              <div class="setting-name">Свържи Google</div>
              <div class="setting-hint">За да влизаш с един клик, без да помниш паролата.</div>
            </div>
            <a class="btn btn-quiet" href="/api/auth/google?next=/app/settings">
              Свържи
            </a>
          </div>
        )}

        {!user.hasPassword && (
          <div class="setting">
            <div class="grow">
              <div class="setting-name">Задай парола</div>
              <div class="setting-hint">
                За да можеш да влизаш и без Google. Ще получиш връзка на имейла си.
              </div>
            </div>
            <a class="btn btn-quiet" href="/forgot">
              Задай парола
            </a>
          </div>
        )}

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Излизане</div>
            <div class="setting-hint">Затваря сесията на това устройство.</div>
          </div>
          <button class="btn btn-quiet" onClick={logout} disabled={busy === 'logout'}>
            {busy === 'logout' ? 'Излизам…' : 'Излез'}
          </button>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Изтегли данните си</div>
            <div class="setting-hint">
              Профил, тетрадки, източници, разговори и бележки — в един JSON файл.
            </div>
          </div>
          <a class="btn btn-quiet" href="/api/me/export" download>
            Изтегли
          </a>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Изтрий профила</div>
            <div class="setting-hint">
              Изтрива тетрадките, източниците, разговорите, аудиото и вгражданията, и спира
              абонамента. Необратимо е.
            </div>
          </div>
          <button
            class="btn btn-quiet danger"
            onClick={deleteAccount}
            disabled={busy === 'delete'}
          >
            {busy === 'delete' ? 'Изтривам…' : 'Изтрий'}
          </button>
        </div>
      </div>

      {/* ── План ───────────────────────────────────────────────────────── */}
      <div class="settings-card">
        <div class="settings-section">План и потребление</div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">
              {plan.name}
              {price !== null && (
                <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
                  {' '}
                  · {formatPrice(price)} / {subscription.interval === 'year' ? 'година' : 'месец'}
                </span>
              )}
            </div>
            <div class="setting-hint">
              {subscription.status === 'past_due'
                ? 'Плащането не мина. Обнови картата си, за да не спре планът.'
                : subscription.cancelAtPeriodEnd && renews
                  ? `Спира на ${renews} Дотогава всичко работи.`
                  : renews
                    ? `Подновява се на ${renews}`
                    : 'Без карта и без срок.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {subscription.plan === 'free' ? (
              <a class="btn btn-primary" style={{ padding: '10px 18px', fontSize: '13.5px' }} href="/pricing">
                Виж плановете
              </a>
            ) : (
              <>
                <a class="btn btn-quiet" href="/pricing">
                  Смени план
                </a>
                {billingEnabled && subscription.hasStripeCustomer && (
                  <button class="btn btn-quiet" onClick={openPortal} disabled={busy === 'portal'}>
                    {busy === 'portal' ? 'Отварям…' : 'Плащане и фактури'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Този месец</div>
            <div class="setting-hint">Броячите се нулират на 1-во число.</div>
          </div>
          <div class="meters">
            <Meter
              label="Тетрадки"
              used={usage.notebooks}
              max={subscription.limits.notebooks}
            />
            <Meter
              label="Въпроси"
              used={usage.questions}
              max={subscription.limits.questionsPerMonth}
            />
            <Meter label="Аудио" used={usage.audio} max={subscription.limits.audioPerMonth} />
          </div>
        </div>
      </div>

      {note && <div class="saved-note">{note}</div>}
      {devLink && (
        <div class="auth-message good" style={{ marginTop: '12px' }}>
          <a href={devLink}>
            <code>{devLink}</code>
          </a>
        </div>
      )}
      {error && (
        <div class="banner-error" style={{ margin: '14px 0 0' }}>
          {error}
        </div>
      )}
    </>
  );
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const unlimited = max === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const full = !unlimited && used >= max;
  return (
    <div class="meter">
      <div class="meter-top">
        <span>{label}</span>
        <span class={full ? 'meter-full' : ''}>
          {used} / {unlimited ? '∞' : max}
        </span>
      </div>
      <div class="meter-track">
        <div
          class="meter-fill"
          style={{ width: unlimited ? '0%' : `${pct}%`, background: full ? '#a3392b' : 'var(--brand)' }}
        />
      </div>
    </div>
  );
}
