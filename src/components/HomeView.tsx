import { useMemo, useState } from 'preact/hooks';
import { ApiError, apiSend } from '~/lib/client';
import { DocIcon, SearchIcon } from './icons';
import type { Notebook } from '~/lib/types';

type Filter = 'all' | 'recent' | 'shared';

interface Props {
  notebooks: Notebook[];
  displayName: string;
  isGuest: boolean;
  /** Таван на плана; `null` значи неограничено. */
  maxNotebooks: number | null;
  /** Колко тетрадки са дошли от профил на гост при влизане. */
  claimed?: number;
}

export default function HomeView({
  notebooks: initial,
  displayName,
  isGuest,
  maxNotebooks,
  claimed = 0,
}: Props) {
  const [notebooks, setNotebooks] = useState(initial);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [quotaHit, setQuotaHit] = useState(false);

  const visible = useMemo(() => {
    if (filter === 'shared') return [];
    const q = query.trim().toLowerCase();
    let list = notebooks;
    if (q) {
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.blurb.toLowerCase().includes(q),
      );
    }
    if (filter === 'recent') {
      const week = Date.now() - 7 * 86_400_000;
      list = list.filter((n) => n.updatedAt >= week);
    }
    return list;
  }, [notebooks, query, filter]);

  async function createNotebook() {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const { notebook } = await apiSend<{ notebook: Notebook }>('/api/notebooks', 'POST', {});
      window.location.href = `/app/notebook/${notebook.id}?add=1`;
    } catch (err) {
      // 402 значи изчерпан план — тогава показваме път напред, не просто грешка.
      if (err instanceof ApiError && err.status === 402) setQuotaHit(true);
      setError(err instanceof ApiError ? err.message : 'Тетрадката не беше създадена.');
      setCreating(false);
    }
  }

  async function removeNotebook(id: string, title: string) {
    if (!confirm(`Да изтрия ли „${title}“ заедно с източниците и разговора?`)) return;
    const before = notebooks;
    setNotebooks((list) => list.filter((n) => n.id !== id));
    try {
      await apiSend(`/api/notebooks/${id}`, 'DELETE');
    } catch (err) {
      setNotebooks(before);
      setError(err instanceof ApiError ? err.message : 'Изтриването се провали.');
    }
  }

  const isEmpty = notebooks.length === 0;

  return (
    <div class="home">
      <div class="home-head">
        <div>
          <h1 class="home-hello">{isGuest ? 'Здравей' : `Здравей, ${displayName}`}</h1>
          <p class="home-sub">
            Качи източниците си и питай каквото искаш. Всеки отговор идва с препратка към документа,
            от който е взет.
          </p>
        </div>
        <div class="grow" />
        <button class="btn btn-primary home-new" onClick={createNotebook} disabled={creating}>
          {creating ? 'Създавам…' : '+ Нова тетрадка'}
        </button>
      </div>

      {!isEmpty && (
        <div class="home-tools">
          <label class="search">
            <span style={{ color: 'var(--faint)', display: 'flex' }}>
              <SearchIcon />
            </span>
            <input
              type="search"
              value={query}
              placeholder="Търси в тетрадките…"
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              aria-label="Търси в тетрадките"
            />
          </label>
          <div class="grow" />
          {maxNotebooks !== null && (
            <span class="quota-pill">
              {notebooks.length} / {maxNotebooks} тетрадки
            </span>
          )}
          <div class="filters">
            <button
              class={`pill filter ${filter === 'all' ? 'on' : ''}`}
              onClick={() => setFilter('all')}
            >
              Всички
            </button>
            <button
              class={`pill filter ${filter === 'recent' ? 'on' : ''}`}
              onClick={() => setFilter('recent')}
            >
              Скорошни
            </button>
            <button
              class={`pill filter ${filter === 'shared' ? 'on' : ''}`}
              onClick={() => setFilter('shared')}
            >
              Споделени с теб
            </button>
          </div>
        </div>
      )}

      {claimed > 0 && (
        <div class="claimed-note">
          {claimed === 1
            ? 'Тетрадката, която направи преди да влезеш, вече е в профила ти.'
            : `${claimed} тетрадки, които направи преди да влезеш, вече са в профила ти.`}
        </div>
      )}

      {error && (
        <div class="banner-error" style={{ margin: '0 0 16px' }}>
          {error}
          {quotaHit && (
            <>
              {' '}
              <a href="/pricing" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                Виж плановете
              </a>
            </>
          )}
        </div>
      )}

      {isEmpty ? (
        <div class="empty">
          <div class="empty-icon" style={{ color: 'var(--brand)' }}>
            <DocIcon />
          </div>
          <h2>Още нямаш тетрадки</h2>
          <p>
            Тетрадката е място за едно нещо, върху което работиш. Добави лекции, PDF-и, линкове или
            бележки и започни да питаш.
          </p>
          <button class="btn btn-primary home-new" onClick={createNotebook} disabled={creating}>
            {creating ? 'Създавам…' : 'Създай първата си тетрадка'}
          </button>
        </div>
      ) : filter === 'shared' ? (
        <div class="empty">
          <h2>Няма споделени тетрадки</h2>
          <p>
            Споделянето между хора още не е включено. Засега всяка тетрадка е видима само от
            устройството, на което е създадена.
          </p>
        </div>
      ) : (
        <div class="grid">
          <button class="nb-new" onClick={createNotebook} disabled={creating}>
            <span class="plus">+</span>
            <span class="label">Нова тетрадка</span>
          </button>

          {visible.map((nb) => (
            <div
              key={nb.id}
              class="nb"
              role="link"
              tabIndex={0}
              onClick={() => (window.location.href = `/app/notebook/${nb.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  window.location.href = `/app/notebook/${nb.id}`;
                }
              }}
            >
              <button
                class="nb-del"
                title="Изтрий тетрадката"
                aria-label={`Изтрий ${nb.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void removeNotebook(nb.id, nb.title);
                }}
              >
                ×
              </button>
              <div class="nb-emoji">{nb.emoji}</div>
              <h2 class="nb-title">{nb.title}</h2>
              <div class="nb-blurb">{nb.blurb}</div>
              <div class="grow" />
              <div class="nb-meta">
                <span>{nb.meta}</span>
              </div>
            </div>
          ))}

          {visible.length === 0 && (
            <div class="nb" style={{ cursor: 'default', borderStyle: 'dashed' }}>
              <div class="nb-blurb">Няма тетрадка, която да отговаря на търсенето.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
