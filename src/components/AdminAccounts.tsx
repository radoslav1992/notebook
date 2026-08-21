import { useEffect, useState } from 'preact/hooks';
import { ApiError, apiGet, apiSend } from '~/lib/client';
import { PLANS } from '~/lib/plans';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  stripeManaged: boolean;
  questions: number;
  notebooks: number;
}

interface AdminOrg {
  id: string;
  name: string;
  members: number;
  seats: number;
  questionsUsed: number;
  questionsTotal: number;
}

const PLAN_IDS = Object.keys(PLANS) as (keyof typeof PLANS)[];

export default function AdminAccounts() {
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<AdminUser | null>(null);
  const [plan, setPlan] = useState('free');
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [seatsDraft, setSeatsDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    apiGet<{ orgs: AdminOrg[] }>('/api/admin/orgs')
      .then((r) => setOrgs(r.orgs))
      .catch(() => setOrgs([]));
  }, []);

  async function find(e: Event) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy('find');
    setError('');
    setNote('');
    setFound(null);
    try {
      const { user } = await apiGet<{ user: AdminUser }>(
        `/api/admin/users?email=${encodeURIComponent(email.trim())}`,
      );
      setFound(user);
      setPlan(user.plan);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Търсенето не мина.');
    } finally {
      setBusy('');
    }
  }

  async function applyPlan() {
    if (!found) return;
    setBusy('plan');
    setError('');
    try {
      const { user } = await apiSend<{ user: AdminUser }>('/api/admin/users', 'PATCH', {
        email: found.email,
        plan,
      });
      setFound(user);
      setNote(`${user.email} вече е на план „${PLANS[user.plan as keyof typeof PLANS]?.name ?? user.plan}“.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Планът не беше сменен.');
    } finally {
      setBusy('');
    }
  }

  async function applySeats(org: AdminOrg) {
    const raw = seatsDraft[org.id] ?? String(org.seats);
    const seats = Number(raw);
    setBusy(`seats:${org.id}`);
    setError('');
    setNote('');
    try {
      const { orgs: next } = await apiSend<{ orgs: AdminOrg[] }>('/api/admin/orgs', 'PATCH', {
        orgId: org.id,
        seats,
      });
      setOrgs(next);
      setSeatsDraft((d) => ({ ...d, [org.id]: '' }));
      setNote(
        seats > 0
          ? `„${org.name}“ е с ${seats} платени места — общ пакет от ${next.find((o) => o.id === org.id)?.questionsTotal ?? '?'} въпроса на месец.`
          : `„${org.name}“ вече е без платени места.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Местата не бяха записани.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div class="settings-card">
        <div class="settings-section">Планове</div>
        <form class="setting" onSubmit={find}>
          <div class="grow">
            <input
              class="input"
              type="email"
              placeholder="Имейл на профила"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
            <div class="setting-hint">
              За сделки по фактура и жестове. Ръчният план важи, докато не го смениш; профил с жив
              Stripe абонамент се управлява само през Stripe.
            </div>
          </div>
          <button class="btn btn-quiet" type="submit" disabled={busy === 'find'}>
            {busy === 'find' ? 'Търся…' : 'Намери'}
          </button>
        </form>

        {found && (
          <div class="setting">
            <div class="grow">
              <div class="setting-name">
                {found.name || found.email}
                <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
                  {' '}
                  · план „{PLANS[found.plan as keyof typeof PLANS]?.name ?? found.plan}“
                  {found.stripeManaged ? ' · през Stripe' : ''} · {found.questions} въпроса ·{' '}
                  {found.notebooks} тетрадки този месец
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                class="select"
                value={plan}
                onChange={(e) => setPlan((e.target as HTMLSelectElement).value)}
              >
                {PLAN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PLANS[id].name}
                  </option>
                ))}
              </select>
              <button
                class="btn btn-quiet"
                onClick={() => void applyPlan()}
                disabled={busy === 'plan' || found.stripeManaged || plan === found.plan}
              >
                {busy === 'plan' ? 'Задавам…' : 'Задай'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="settings-card">
        <div class="settings-section">
          Организации{' '}
          <span style={{ color: 'var(--faint)', fontWeight: 500 }}>· {orgs.length}</span>
        </div>

        {orgs.length === 0 && (
          <div class="setting">
            <div class="grow">
              <div class="setting-hint">
                Още няма организации. Създават се от потребителите в Настройки.
              </div>
            </div>
          </div>
        )}

        {orgs.map((o) => (
          <div class="setting" key={o.id}>
            <div class="grow">
              <div class="setting-name">
                {o.name}
                <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
                  {' '}
                  · {o.members} {o.members === 1 ? 'член' : 'членове'}
                  {o.seats > 0
                    ? ` · ${o.seats} места · ${o.questionsUsed}/${o.questionsTotal} въпроса този месец`
                    : ' · без платени места'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                class="input"
                style={{ width: '90px' }}
                type="number"
                min={0}
                max={10000}
                placeholder={String(o.seats)}
                value={seatsDraft[o.id] ?? ''}
                onInput={(e) =>
                  setSeatsDraft((d) => ({ ...d, [o.id]: (e.target as HTMLInputElement).value }))
                }
              />
              <button
                class="btn btn-quiet"
                onClick={() => void applySeats(o)}
                disabled={busy === `seats:${o.id}` || (seatsDraft[o.id] ?? '') === ''}
              >
                {busy === `seats:${o.id}` ? 'Записвам…' : 'Запази'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {note && <div class="saved-note">{note}</div>}
      {error && <div class="banner-error" style={{ margin: '14px 0 0' }}>{error}</div>}
    </>
  );
}
