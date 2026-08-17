import { useEffect, useState } from 'preact/hooks';
import { ApiError, apiSend, getLocalKey, maskKey, setLocalKey } from '~/lib/client';
import { USE_CASES } from '~/lib/prompts';
import type { ModelChoice } from '~/lib/ai/choices';
import type { Settings, User } from '~/lib/types';

interface Props {
  settings: Settings;
  user: User;
  hasServerKey: boolean;
  ragBackend: 'vectorize' | 'gemini';
  /** Дали планът дава достъп до по-скъпия модел. */
  proModel: boolean;
  /**
   * Моделите, които тази инсталация предлага. Идват от конфигурацията, защото
   * при доставчик Cloudflare имената са съвсем други.
   */
  models: ModelChoice[];
}

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'bg', label: 'Български' },
  { value: 'en', label: 'Английски' },
  { value: 'de', label: 'Немски' },
  { value: 'ru', label: 'Руски' },
];

export default function SettingsView({
  settings: initial,
  user: initialUser,
  hasServerKey,
  ragBackend,
  proModel,
  models,
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [user, setUser] = useState(initialUser);
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [name, setName] = useState(initialUser.displayName);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    setSavedKey(getLocalKey());
  }, []);

  // Браузърът казва кога инсталирането е възможно; държим подсказката за него.
  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      installPrompt = event as InstallEvent;
      setInstallable(true);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function patch(body: Partial<Settings> & { displayName?: string }) {
    setError('');
    try {
      const res = await apiSend<{ settings: Settings; user: User }>('/api/settings', 'PATCH', body);
      setSettings(res.settings);
      setUser(res.user);
      flash('Запазено');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Запазването се провали.');
    }
  }

  function flash(text: string) {
    setNote(text);
    window.setTimeout(() => setNote(''), 2200);
  }

  function saveKey() {
    setLocalKey(key);
    setSavedKey(key.trim());
    setKey('');
    setEditingKey(false);
    flash(key.trim() ? 'Ключът е запазен в този браузър' : 'Ключът е изтрит');
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    setInstallable(false);
  }

  return (
    <>
      <div class="settings-card">
        <div class="settings-section">Модел</div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Gemini API ключ</div>
            <div class="setting-hint">
              Съхранява се локално на устройството ти и се праща само при твоите заявки.
              {hasServerKey
                ? ' Сървърът има свой ключ, така че този е по избор.'
                : ' Сървърът няма ключ — без този тук приложението не може да отговаря.'}
            </div>
          </div>
          {editingKey ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                class="field key-input"
                type="password"
                value={key}
                placeholder="AIza…"
                autocomplete="off"
                onInput={(e) => setKey((e.target as HTMLInputElement).value)}
              />
              <button class="btn btn-quiet" onClick={saveKey}>
                Запази
              </button>
              <button class="btn btn-quiet" onClick={() => setEditingKey(false)}>
                Отказ
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span class="setting-value">{savedKey ? maskKey(savedKey) : 'не е зададен'}</span>
              <button class="btn btn-quiet" onClick={() => setEditingKey(true)}>
                {savedKey ? 'Смени' : 'Задай'}
              </button>
            </div>
          )}
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Модел за отговорите</div>
            <div class="setting-hint">
              Pro е по-точен при дълги документи, Flash е по-бърз.
              {!proModel && ' Pro е достъпен в платените планове.'}
            </div>
          </div>
          <select
            class="select"
            value={settings.chatModel || models[0]?.value}
            onChange={(e) => void patch({ chatModel: (e.target as HTMLSelectElement).value })}
          >
            {models.map((m) => (
              <option key={m.value} value={m.value} disabled={m.pro && !proModel}>
                {m.label}
                {m.pro && !proModel ? ' (Плюс)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">За какво го ползваш</div>
            <div class="setting-hint">
              Сменя кои материали предлага студиото: резюме и въпроси за проверка, учебно
              ръководство и изпит, задължения и рискове, обзор, или решения и стъпки.
            </div>
          </div>
          <select
            class="select"
            value={settings.useCase}
            onChange={(e) => void patch({ useCase: (e.target as HTMLSelectElement).value })}
          >
            <option value="">Общи материали</option>
            {USE_CASES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Език на отговорите</div>
            <div class="setting-hint">Езикът, на който отговаря моделът.</div>
          </div>
          <select
            class="select"
            value={settings.responseLanguage}
            onChange={(e) => void patch({ responseLanguage: (e.target as HTMLSelectElement).value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Търсене в източниците</div>
            <div class="setting-hint">
              {ragBackend === 'gemini'
                ? 'Управляваното File Search хранилище на Google.'
                : 'Собствен индекс в Cloudflare Vectorize — цитатите сочат до страница.'}
            </div>
          </div>
          <span class="setting-chip">
            {ragBackend === 'gemini' ? 'Google File Search' : 'Vectorize'}
          </span>
        </div>

        <div class="setting">
          <div class="grow">
            <div class="setting-name">Офлайн режим</div>
            <div class="setting-hint">Пази последните тетрадки за четене без интернет.</div>
          </div>
          <button
            class={`toggle ${settings.offlineMode ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.offlineMode}
            aria-label="Офлайн режим"
            onClick={() => void patch({ offlineMode: !settings.offlineMode })}
          >
            <span class="knob" />
          </button>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-section">Показвано име</div>
        <div class="setting">
          <div class="grow">
            <div class="setting-name">Име</div>
            <div class="setting-hint">
              Показва се на началния екран и в аватара ({user.initials}).
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              class="field"
              style={{ maxWidth: '200px' }}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <button
              class="btn btn-quiet"
              onClick={() => void patch({ displayName: name })}
              disabled={!name.trim() || name.trim() === user.displayName}
            >
              Запази
            </button>
          </div>
        </div>
      </div>

      <div class="settings-block">
        <div class="setting-name">Инсталирай Записки</div>
        <p>
          Добави приложението на началния екран на телефона или на работния плот. Работи и без
          интернет за вече отворените тетрадки.
        </p>
        {installable ? (
          <button class="btn btn-primary" onClick={install}>
            Инсталирай
          </button>
        ) : (
          <div class="setting-hint">
            Браузърът ще предложи инсталиране сам. В Safari използвай „Споделяне → Към началния
            екран“.
          </div>
        )}
      </div>

      {note && <div class="saved-note">{note}</div>}
      {error && (
        <div class="banner-error" style={{ margin: '14px 0 0' }}>
          {error}
        </div>
      )}
    </>
  );
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

let installPrompt: InstallEvent | null = null;
