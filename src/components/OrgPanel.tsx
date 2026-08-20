import { useEffect, useState } from 'preact/hooks';
import { ApiError, apiGet, apiSend } from '~/lib/client';

interface Org {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  libraryId: string;
}

interface Member {
  id: string;
  email: string | null;
  name: string;
  role: string;
  you: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'собственик',
  admin: 'администратор',
  member: 'член',
};

export default function OrgPanel({
  emailEnabled,
  isAdmin = false,
}: {
  emailEnabled: boolean;
  isAdmin?: boolean;
}) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    apiGet<{ orgs: Org[] }>('/api/orgs')
      .then((r) => setOrgs(r.orgs))
      .catch(() => setOrgs([]));
  }, []);

  async function loadMembers(orgId: string) {
    try {
      const r = await apiGet<{ members: Member[] }>(`/api/orgs/${orgId}/members`);
      setMembers((m) => ({ ...m, [orgId]: r.members }));
    } catch {
      // Списъкът с членове е допълнение; провалът му не бива да скрива панела.
    }
  }

  useEffect(() => {
    for (const org of orgs ?? []) void loadMembers(org.id);
  }, [orgs]);

  async function create(e: Event) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy('create');
    setError('');
    try {
      const { org } = await apiSend<{ org: Org }>('/api/orgs', 'POST', { name });
      setOrgs((list) => [...(list ?? []), org]);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Организацията не беше създадена.');
    } finally {
      setBusy('');
    }
  }

  async function send(orgId: string) {
    const email = (invite[orgId] ?? '').trim();
    if (!email) return;
    setBusy(`invite:${orgId}`);
    setError('');
    setLink('');
    setNote('');
    try {
      const r = await apiSend<{ email: string; emailSent: boolean; link: string }>(
        `/api/orgs/${orgId}/invites`,
        'POST',
        { email },
      );
      setInvite((v) => ({ ...v, [orgId]: '' }));
      setNote(
        r.emailSent
          ? `Поканата е изпратена на ${r.email}.`
          : `Няма настроен доставчик на писма — прати връзката на ${r.email} сам.`,
      );
      // Показва се винаги: писмото може и да не пристигне, а поканата важи 14 дни.
      setLink(r.link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Поканата не беше изпратена.');
    } finally {
      setBusy('');
    }
  }

  if (orgs === null) return null;

  return (
    <div class="settings-card">
      <div class="settings-section">Организации</div>

      {orgs.length === 0 && (
        <div class="setting">
          <div class="grow">
            <div class="setting-name">Още не си в организация</div>
            <div class="setting-hint">
              Организацията има обща библиотека: качваш източник веднъж, а всички членове го
              включват в своите тетрадки. Подходящо за курс, катедра или училище.
            </div>
          </div>
        </div>
      )}

      {orgs.map((org) => (
        <div class="setting" key={org.id}>
          <div class="grow">
            <div class="setting-name">
              {org.name}
              <span style={{ color: 'var(--faint)', fontWeight: 500 }}> · {ROLE_LABEL[org.role]}</span>
            </div>
            <div class="setting-hint">
              {(members[org.id] ?? []).length > 0 && (
                <>
                  {members[org.id]!.length}{' '}
                  {members[org.id]!.length === 1 ? 'член' : 'членове'}:{' '}
                  {members[org.id]!.map((m) => m.email ?? m.name).join(', ')}
                  <br />
                </>
              )}
              {org.role === 'member'
                ? 'Общите източници се включват от панела с източниците в тетрадка.'
                : 'Ти можеш да качваш в библиотеката и да каниш хора.'}
            </div>

            {org.role !== 'member' && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                <input
                  class="input"
                  type="email"
                  placeholder="имейл за покана"
                  value={invite[org.id] ?? ''}
                  onInput={(e) =>
                    setInvite((v) => ({ ...v, [org.id]: (e.target as HTMLInputElement).value }))
                  }
                  style={{ maxWidth: '240px' }}
                />
                <button
                  class="btn btn-quiet"
                  onClick={() => send(org.id)}
                  disabled={busy === `invite:${org.id}`}
                >
                  {busy === `invite:${org.id}` ? 'Пращам…' : 'Покани'}
                </button>
              </div>
            )}
          </div>

          {org.role !== 'member' && (
            <a class="btn btn-quiet" href={`/app/library/${org.libraryId}`}>
              Библиотеката
            </a>
          )}
        </div>
      ))}

      {isAdmin && (
        <div class="setting">
          <div class="grow">
            <div class="setting-name">Общи набори</div>
            <div class="setting-hint">
              Управление на готовото съдържание, което всички включват в тетрадките си.
            </div>
          </div>
          <a class="btn btn-quiet" href="/app/admin">
            Отвори
          </a>
        </div>
      )}

      <form class="setting" onSubmit={create}>
        <div class="grow">
          <div class="setting-name">Нова организация</div>
          <div class="setting-hint">
            Ти ставаш собственик и получаваш празна библиотека.
            {!emailEnabled && ' Без доставчик на писма поканите се пращат на ръка — връзката се показва тук.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            class="input"
            placeholder="напр. 11-в клас"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            style={{ maxWidth: '200px' }}
          />
          <button class="btn btn-quiet" type="submit" disabled={busy === 'create'}>
            {busy === 'create' ? 'Създавам…' : 'Създай'}
          </button>
        </div>
      </form>

      {note && <div class="saved-note">{note}</div>}
      {link && (
        <div class="auth-message good" style={{ marginTop: '12px', wordBreak: 'break-all' }}>
          <a href={link}>
            <code>{link}</code>
          </a>
        </div>
      )}
      {error && (
        <div class="banner-error" style={{ margin: '14px 0 0' }}>
          {error}
        </div>
      )}
    </div>
  );
}
