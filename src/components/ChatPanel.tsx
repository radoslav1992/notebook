import { useEffect, useRef, useState } from 'preact/hooks';
import { renderMarkdown } from '~/lib/markdown';
import { SUGGESTED_PROMPTS } from '~/lib/prompts';
import { ArrowIcon } from './icons';
import type { Citation, Message, Notebook } from '~/lib/types';

interface Props {
  notebook: Notebook;
  messages: Message[];
  streaming: string | null;
  thinking: boolean;
  error: string;
  model: string;
  selectedCount: number;
  totalCount: number;
  onAsk: (question: string) => void;
  onCitation: (citation: Citation) => void;
  active: boolean;
}

export default function ChatPanel({
  notebook,
  messages,
  streaming,
  thinking,
  error,
  model,
  selectedCount,
  totalCount,
  onAsk,
  onCitation,
  active,
}: Props) {
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = thinking || streaming !== null;

  // Държим погледа долу, докато отговорът тече.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, thinking]);

  function submit(text?: string) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    onAsk(question);
    setInput('');
    if (box.current) box.current.style.height = 'auto';
  }

  return (
    <section class={`panel chat ${active ? 'active' : ''}`} aria-label="Чат">
      <div class="chat-head">
        <span class="chat-emoji">{notebook.emoji}</span>
        <div class="chat-titles">
          <div class="chat-title">{notebook.title}</div>
          <div class="chat-meta">
            {totalCount === 0
              ? 'няма източници'
              : `${selectedCount} от ${totalCount} ${totalCount === 1 ? 'източник' : 'източника'} избрани`}
          </div>
        </div>
        <span class="model-badge">{modelLabel(model)}</span>
      </div>

      <div class="chat-scroll" ref={scroller}>
        {messages.length === 0 && !busy ? (
          <div class="chat-blank">
            <h2>Питай нещо за източниците си</h2>
            <p>
              Отговарям само по това, което си качил, и слагам препратка към мястото в документа.
              Ако отговорът го няма в източниците, ще ти го кажа.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} class={`msg ${m.role}`}>
              <div class="bubble">
                {m.role === 'ai' ? (
                  <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                ) : (
                  <div>{m.text}</div>
                )}
                {m.citations.length > 0 && (
                  <div class="bubble-cites">
                    {m.citations.map((c) => (
                      <button
                        key={`${m.id}-${c.ordinal}`}
                        class="cite"
                        onClick={() => onCitation(c)}
                        title="Виж пасажа от източника"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {streaming !== null && (
          <div class="msg ai">
            <div class="bubble">
              <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming) }} />
            </div>
          </div>
        )}

        {thinking && (
          <div class="thinking">
            <span class="dot" />
            <span>Чета източниците…</span>
          </div>
        )}
      </div>

      {error && <div class="banner-error">{error}</div>}

      <div class="composer-wrap">
        <div class="suggestions">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p.label}
              class="suggestion"
              onClick={() => submit(p.text)}
              disabled={busy}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div class="composer-box">
          <textarea
            ref={box}
            rows={1}
            value={input}
            placeholder="Питай нещо за източниците си…"
            aria-label="Въпрос към източниците"
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setInput(el.value);
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            class="send-btn"
            onClick={() => submit()}
            disabled={busy || input.trim().length === 0}
            aria-label="Изпрати"
          >
            <ArrowIcon />
          </button>
        </div>
        <div class="disclaimer">Записки може да греши. Проверявай важното в източника.</div>
      </div>
    </section>
  );
}

function modelLabel(model: string): string {
  if (model.includes('pro')) return 'Gemini Pro';
  if (model.includes('lite')) return 'Gemini Lite';
  return 'Gemini';
}
