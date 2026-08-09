import { useState } from 'preact/hooks';
import { ApiError, apiSend } from '~/lib/client';

interface Props {
  /** Публичният адрес — показва се като алтернатива на формата. */
  contactEmail: string;
  /** Имейлът на влезлия човек, за да не го въвежда пак. */
  knownEmail?: string | null;
  knownName?: string | null;
}

const MIN_MESSAGE = 15;
const MAX_MESSAGE = 4000;

export default function ContactForm({ contactEmail, knownEmail, knownName }: Props) {
  const [name, setName] = useState(knownName ?? '');
  const [email, setEmail] = useState(knownEmail ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiSend('/api/contact', 'POST', { name, email, message });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Съобщението не се изпрати. Опитай пак.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div class="auth-message good" style={{ fontSize: '14px', lineHeight: 1.65 }}>
        <strong>Съобщението тръгна.</strong>
        <br />
        Отговаряме на адреса, който остави. Ако е спешно, пиши направо на{' '}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </div>
    );
  }

  const trimmed = message.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_MESSAGE;

  return (
    <form onSubmit={submit}>
      <div class="auth-field">
        <label for="contact-name">Име</label>
        <input
          id="contact-name"
          class="field"
          type="text"
          value={name}
          maxLength={80}
          autocomplete="name"
          placeholder="По желание"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="auth-field">
        <label for="contact-email">Имейл</label>
        <input
          id="contact-email"
          class="field"
          type="email"
          value={email}
          required
          autocomplete="email"
          placeholder="за да можем да отговорим"
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="auth-field">
        <label for="contact-message">Съобщение</label>
        <textarea
          id="contact-message"
          class="field"
          value={message}
          required
          rows={7}
          maxLength={MAX_MESSAGE}
          style={{ resize: 'vertical', minHeight: '150px', lineHeight: 1.6 }}
          placeholder="Какво се случва, какво очакваше да стане, и на кой екран."
          onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
        />
        <div class="auth-hint">
          {tooShort
            ? 'Още малко — поне няколко изречения.'
            : `${trimmed.length} от ${MAX_MESSAGE} знака`}
        </div>
      </div>

      {error && <div class="auth-message bad">{error}</div>}

      <button class="btn btn-primary auth-submit" type="submit" disabled={busy}>
        {busy ? 'Изпращам…' : 'Изпрати'}
      </button>

      <p class="auth-note">
        Или направо на <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>
    </form>
  );
}
