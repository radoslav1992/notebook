import { useState } from 'preact/hooks';
import { ApiError, apiSend } from '~/lib/client';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

interface Props {
  mode: Mode;
  googleEnabled: boolean;
  emailEnabled: boolean;
  /** За mode='reset' — токенът от връзката в писмото. */
  token?: string;
  /** Къде да отидем след успех. */
  next?: string;
  /** Съобщение от адреса, напр. след отказ от Google. */
  initialError?: string;
  /** Колко тетрадки чакат в профила на госта. */
  guestNotebooks?: number;
}

export default function AuthCard({
  mode,
  googleEnabled,
  emailEnabled,
  token,
  next = '/app',
  initialError = '',
  guestNotebooks = 0,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [good, setGood] = useState('');
  const [devLink, setDevLink] = useState('');

  async function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setGood('');
    setDevLink('');

    try {
      if (mode === 'login') {
        const res = await apiSend<{ claimedNotebooks: number }>('/api/auth/login', 'POST', {
          email,
          password,
        });
        redirect(next, res.claimedNotebooks);
        return;
      }

      if (mode === 'register') {
        const res = await apiSend<{ verifyLink?: string; keptNotebooks: number }>(
          '/api/auth/register',
          'POST',
          { email, password, name },
        );
        if (res.verifyLink) {
          // Няма настроен доставчик на писма — показваме връзката, за да е ползваемо.
          setGood('Профилът е готов. Няма настроен имейл доставчик, затова връзката за потвърждаване е тук:');
          setDevLink(res.verifyLink);
          setBusy(false);
          return;
        }
        redirect(next, res.keptNotebooks);
        return;
      }

      if (mode === 'forgot') {
        const res = await apiSend<{ message: string; resetLink?: string }>(
          '/api/auth/forgot',
          'POST',
          { email },
        );
        setGood(res.message);
        if (res.resetLink) setDevLink(res.resetLink);
        setBusy(false);
        return;
      }

      await apiSend('/api/auth/reset', 'POST', { token, password });
      redirect('/app', 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Нещо се обърка. Опитай пак.');
      setBusy(false);
    }
  }

  function redirect(path: string, claimed: number) {
    const url = new URL(path, window.location.origin);
    if (claimed > 0) url.searchParams.set('claimed', String(claimed));
    window.location.href = url.toString();
  }

  const copy = COPY[mode];

  return (
    <>
      <div class="auth-card">
        <h1>{copy.title}</h1>
        <p class="sub">
          {mode === 'register' && guestNotebooks > 0
            ? `Регистрирай се, за да запазиш ${guestNotebooks === 1 ? 'тетрадката' : `${guestNotebooks} тетрадки`}, ${
                guestNotebooks === 1 ? 'която' : 'които'
              } вече направи, и да ${guestNotebooks === 1 ? 'я' : 'ги'} отваряш от всяко устройство.`
            : copy.sub}
        </p>

        {error && <div class="auth-message bad">{error}</div>}
        {good && (
          <div class="auth-message good">
            {good}
            {devLink && (
              <>
                <br />
                <br />
                <a href={devLink}>
                  <code>{devLink}</code>
                </a>
              </>
            )}
          </div>
        )}

        <form onSubmit={submit} novalidate>
          {mode === 'register' && (
            <div class="auth-field">
              <label for="name">Име</label>
              <input
                id="name"
                class="field"
                value={name}
                autocomplete="name"
                placeholder="Радослав Дойников"
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
              <div class="auth-hint">По избор — ползва се за поздрава и аватара.</div>
            </div>
          )}

          {mode !== 'reset' && (
            <div class="auth-field">
              <label for="email">Имейл</label>
              <input
                id="email"
                class="field"
                type="email"
                required
                value={email}
                autocomplete="email"
                placeholder="ime@primer.bg"
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div class="auth-field">
              <label for="password">{mode === 'reset' ? 'Нова парола' : 'Парола'}</label>
              <input
                id="password"
                class="field"
                type="password"
                required
                value={password}
                autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••••"
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              />
              {mode !== 'login' && <div class="auth-hint">Поне 10 знака.</div>}
            </div>
          )}

          <button class="btn btn-primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Момент…' : copy.action}
          </button>
        </form>

        {mode !== 'reset' && googleEnabled && (
          <>
            <div class="auth-or">или</div>
            <a class="auth-google" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
              <GoogleMark />
              Продължи с Google
            </a>
          </>
        )}

        <div class="auth-foot">
          {mode === 'login' && (
            <>
              <a href="/forgot">Забравена парола?</a>
              <br />
              Още нямаш профил? <a href="/register">Регистрирай се</a>
            </>
          )}
          {mode === 'register' && (
            <>
              Вече имаш профил? <a href="/login">Влез</a>
            </>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <>
              <a href="/login">Обратно към входа</a>
            </>
          )}
        </div>
      </div>

      {mode === 'register' && !emailEnabled && (
        <p class="auth-note">
          На този сървър няма настроен доставчик на писма, затова връзката за потвърждаване се
          показва на екрана вместо да се изпраща.
        </p>
      )}
    </>
  );
}

const COPY: Record<Mode, { title: string; sub: string; action: string }> = {
  login: {
    title: 'Влез в Записки',
    sub: 'Тетрадките, източниците и разговорите те чакат.',
    action: 'Влез',
  },
  register: {
    title: 'Направи профил',
    sub: 'Безплатно за първите три тетрадки. Без карта.',
    action: 'Създай профил',
  },
  forgot: {
    title: 'Забравена парола',
    sub: 'Въведи имейла си и ще получиш връзка за нова парола.',
    action: 'Изпрати връзка',
  },
  reset: {
    title: 'Нова парола',
    sub: 'Избери нова парола. Всички други устройства ще излязат от профила.',
    action: 'Запази паролата',
  },
};

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h11.9c-.2 2-1.5 4.9-4.4 6.9l-.1.3 6.4 4.9.4.1c4.1-3.8 6.9-9.3 6.9-15.8"
      />
      <path
        fill="#34A853"
        d="M24 46c5.5 0 10.2-1.8 13.6-4.9l-6.5-5c-1.7 1.2-4.1 2.1-7.1 2.1-5.4 0-10-3.6-11.6-8.5l-.3.1-6.6 5v.3C8.9 41.3 15.9 46 24 46"
      />
      <path
        fill="#FBBC05"
        d="M12.4 29.7c-.4-1.3-.7-2.6-.7-4s.2-2.7.6-4l-.1-.3-6.7-5.2-.2.1C4 19.1 3 21.4 3 25.7s1 6.6 2.4 9.4z"
      />
      <path
        fill="#EA4335"
        d="M24 11.3c3.8 0 6.4 1.7 7.9 3.1l5.7-5.6C34.1 5.6 29.5 3.7 24 3.7 15.9 3.7 8.9 8.4 5.4 15.3l7 5.4c1.6-4.9 6.2-9.4 11.6-9.4"
      />
    </svg>
  );
}
