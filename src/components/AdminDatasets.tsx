import { useEffect, useState } from 'preact/hooks';
import { ApiError, apiGet, apiSend } from '~/lib/client';
import { USE_CASES } from '~/lib/prompts';

interface Dataset {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  useCases: string[];
  published: boolean;
  sourceCount: number;
}

interface NotebookRow {
  id: string;
  title: string;
  emoji: string;
  sourceCount: number;
}

export default function AdminDatasets({ datasets: initial }: { datasets: Dataset[] }) {
  const [datasets, setDatasets] = useState(initial);
  const [notebooks, setNotebooks] = useState<NotebookRow[]>([]);
  const [adoptId, setAdoptId] = useState('');
  const [title, setTitle] = useState('');
  const [blurb, setBlurb] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // Своите тетрадки — за „превърни в набор“. Само с източници: празна тетрадка
  // няма какво да даде, а изборът да е къс е по-важно от изборът да е пълен.
  useEffect(() => {
    apiGet<{ notebooks: NotebookRow[] }>('/api/notebooks')
      .then((r) => setNotebooks(r.notebooks.filter((n) => n.sourceCount > 0)))
      .catch(() => setNotebooks([]));
  }, []);

  async function adopt() {
    if (!adoptId) return;
    const nb = notebooks.find((n) => n.id === adoptId);
    // Необратимо в интерфейса (обратен път няма), затова се потвърждава изрично.
    if (
      !nb ||
      !confirm(
        `„${nb.title}“ ще стане общ набор: изчезва от личните ти тетрадки, а разговорите в нея спират да се отварят. Източниците и индексът се запазват без ново вграждане. Продължавам ли?`,
      )
    ) {
      return;
    }
    setBusy('adopt');
    setError('');
    try {
      const { dataset } = await apiSend<{ dataset: Dataset }>('/api/admin/datasets/adopt', 'POST', {
        notebookId: adoptId,
      });
      setDatasets((list) => [...list, dataset]);
      setNotebooks((list) => list.filter((n) => n.id !== adoptId));
      setAdoptId('');
      setNote(`„${dataset.title}“ вече е набор. Добави описание с редакцията и го публикувай.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Тетрадката не беше превърната.');
    } finally {
      setBusy('');
    }
  }

  function patchLocal(id: string, patch: Partial<Dataset>) {
    setDatasets((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function create(e: Event) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setBusy('create');
    setError('');
    try {
      const { dataset } = await apiSend<{ dataset: Dataset }>('/api/admin/datasets', 'POST', {
        title,
        blurb,
        useCases: picked,
      });
      setDatasets((list) => [...list, dataset]);
      setTitle('');
      setBlurb('');
      setPicked([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Наборът не беше създаден.');
    } finally {
      setBusy('');
    }
  }

  async function send(id: string, body: Record<string, unknown>, label: string) {
    setBusy(`${label}:${id}`);
    setError('');
    setNote('');
    try {
      await apiSend(`/api/admin/datasets/${id}`, 'PATCH', body);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Промяната не мина.');
      return false;
    } finally {
      setBusy('');
    }
  }

  async function togglePublished(d: Dataset) {
    // Празен набор не бива да се публикува: индексът е наполовина готов и
    // отговорите по него биха били произволни, а човекът вече му вярва.
    if (!d.published && d.sourceCount === 0) {
      setError(`„${d.title}“ е празен — качи поне един източник, преди да го публикуваш.`);
      return;
    }
    const next = !d.published;
    if (await send(d.id, { published: next }, 'pub')) patchLocal(d.id, { published: next });
  }

  async function toggleUseCase(d: Dataset, value: string) {
    const next = d.useCases.includes(value)
      ? d.useCases.filter((u) => u !== value)
      : [...d.useCases, value];
    if (await send(d.id, { useCases: next }, 'uc')) patchLocal(d.id, { useCases: next });
  }

  async function grant(d: Dataset) {
    const email = window.prompt(`На кой имейл да дам достъп до „${d.title}“?`);
    if (!email) return;
    if (await send(d.id, { grantTo: email }, 'grant')) {
      setNote(`${email} вече има достъп до „${d.title}“.`);
    }
  }

  return (
    <>
      <div class="settings-card">
        <div class="settings-section">Нов набор</div>
        <form class="setting" onSubmit={create}>
          <div class="grow">
            <input
              class="input"
              placeholder="Име, напр. Кодекс на труда"
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            />
            <input
              class="input"
              placeholder="Кратко описание за потребителя"
              value={blurb}
              onInput={(e) => setBlurb((e.target as HTMLInputElement).value)}
              style={{ marginTop: '8px' }}
            />
            <div class="ds-uses">
              {USE_CASES.map((u) => (
                <label key={u.value} class="ds-use">
                  <input
                    type="checkbox"
                    checked={picked.includes(u.value)}
                    onChange={() =>
                      setPicked((p) =>
                        p.includes(u.value) ? p.filter((x) => x !== u.value) : [...p, u.value],
                      )
                    }
                  />
                  {u.label}
                </label>
              ))}
            </div>
            <div class="setting-hint">
              Без отметка наборът се предлага на всички употреби. Създава се непубликуван — първо
              качваш, после публикуваш.
            </div>
          </div>
          <button class="btn btn-quiet" type="submit" disabled={busy === 'create'}>
            {busy === 'create' ? 'Създавам…' : 'Създай'}
          </button>
        </form>
      </div>

      {notebooks.length > 0 && (
        <div class="settings-card">
          <div class="settings-section">От съществуваща тетрадка</div>
          <div class="setting">
            <div class="grow">
              <div class="setting-name">Превърни тетрадка в набор</div>
              <div class="setting-hint">
                Без ново качване и без ново вграждане — индексът се запазва. Тетрадката спира да е
                лична: изчезва от списъка ти, а разговорите в нея спират да се отварят.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                class="select"
                value={adoptId}
                onChange={(e) => setAdoptId((e.target as HTMLSelectElement).value)}
              >
                <option value="">Избери тетрадка…</option>
                {notebooks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.emoji} {n.title} · {n.sourceCount} изт.
                  </option>
                ))}
              </select>
              <button
                class="btn btn-quiet"
                onClick={() => void adopt()}
                disabled={!adoptId || busy === 'adopt'}
              >
                {busy === 'adopt' ? 'Превръщам…' : 'Превърни'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div class="settings-card">
        <div class="settings-section">
          Набори <span style={{ color: 'var(--faint)', fontWeight: 500 }}>· {datasets.length}</span>
        </div>

        {datasets.length === 0 && (
          <div class="setting">
            <div class="grow">
              <div class="setting-hint">Още няма набори. Направи първия отгоре.</div>
            </div>
          </div>
        )}

        {datasets.map((d) => (
          <div class="setting" key={d.id}>
            <div class="grow">
              <div class="setting-name">
                {d.emoji} {d.title}
                <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
                  {' '}
                  · {d.sourceCount} {d.sourceCount === 1 ? 'източник' : 'източника'}
                  {d.published ? '' : ' · непубликуван'}
                </span>
              </div>
              {d.blurb && <div class="setting-hint">{d.blurb}</div>}
              <div class="ds-uses">
                {USE_CASES.map((u) => (
                  <label key={u.value} class="ds-use">
                    <input
                      type="checkbox"
                      checked={d.useCases.includes(u.value)}
                      disabled={busy === `uc:${d.id}`}
                      onChange={() => void toggleUseCase(d, u.value)}
                    />
                    {u.label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <a class="btn btn-quiet" href={`/app/admin/dataset/${d.id}`}>
                Съдържание
              </a>
              <button class="btn btn-quiet" onClick={() => void grant(d)} disabled={busy === `grant:${d.id}`}>
                Дай достъп
              </button>
              <button
                class={`btn btn-quiet ${d.published ? 'danger' : ''}`}
                onClick={() => void togglePublished(d)}
                disabled={busy === `pub:${d.id}`}
              >
                {d.published ? 'Скрий' : 'Публикувай'}
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
