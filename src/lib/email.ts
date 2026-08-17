/**
 * Изпращане на имейл. Два доставчика, избрани по това какво е налично:
 *
 *   1. **Cloudflare Email Service** — binding-ът `EMAIL` (`send_email` в
 *      wrangler.jsonc). Нищо за плащане отделно и нищо за поддържане.
 *   2. **Resend** — обикновен REST, ако binding-ът липсва, но има ключ.
 *   3. Нито едното — писмото се записва в лога, а връзката се връща в
 *      интерфейса. Така локалната работа не иска доставчик.
 *
 * Cloudflare праща до произволен получател само след като изпращащият домейн е
 * onboard-нат в Email Service. Дотогава минават единствено адресите, потвърдени
 * в Email Routing — виж docs/email.md.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** Подателят по подразбиране; сменя се с променливата `EMAIL_FROM`. */
export const DEFAULT_FROM = 'Записки <noreply@zapiski.bg>';

/** Адресът, който пише на сайта. Не е този, на който идва формата за контакт. */
export const DEFAULT_CONTACT_EMAIL = 'info@zapiski.bg';

/** Къде отиват съобщенията от формата за контакт. */
export const DEFAULT_CONTACT_TO = 'dev.radoslav.dodnikov@gmail.com';

export interface Address {
  name: string;
  email: string;
}

export interface Letter {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Отговорът да отиде при друг — ползва се от формата за контакт. */
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  /** „cloudflare“ | „resend“ | „none“ — влиза в лога, когато нещо не е ясно. */
  readonly provider: 'cloudflare' | 'resend' | 'none';
  send(letter: Letter): Promise<void>;
}

export interface MailEnv {
  /** Cloudflare Email Service. Липсва в тестове и при `astro dev`. */
  EMAIL?: {
    send(builder: {
      to: string | Address | (string | Address)[];
      from: string | Address;
      subject: string;
      html?: string;
      text?: string;
      replyTo?: string | Address;
      headers?: Record<string, string>;
    }): Promise<unknown>;
  };
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function mailer(env: MailEnv): Mailer {
  const from = (env.EMAIL_FROM || DEFAULT_FROM).trim();

  // Cloudflare е първи: когато binding-ът го има, той е нагласеният път и няма
  // смисъл да се плаща на друг доставчик.
  if (env.EMAIL) {
    const binding = env.EMAIL;
    return {
      enabled: true,
      provider: 'cloudflare',
      async send({ to, subject, html, text, replyTo }) {
        await binding.send({
          to,
          from: parseAddress(from),
          subject,
          html,
          text,
          ...(replyTo ? { replyTo } : {}),
        });
      },
    };
  }

  const key = env.RESEND_API_KEY;
  if (key) {
    return {
      enabled: true,
      provider: 'resend',
      async send({ to, subject, html, text, replyTo }) {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            html,
            text,
            ...(replyTo ? { reply_to: [replyTo] } : {}),
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Имейлът не беше изпратен (${res.status}): ${detail.slice(0, 300)}`);
        }
      },
    };
  }

  return {
    enabled: false,
    provider: 'none',
    async send({ to, subject, text }) {
      console.warn(`[zapiski:email] няма доставчик — писмото до ${to} не е изпратено`);
      console.warn(`[zapiski:email] ${subject}\n${text}`);
    },
  };
}

/**
 * „Записки <noreply@zapiski.bg>“ → `{ name, email }`.
 *
 * Cloudflare приема или чист адрес, или обект с име; низ с ъглови скоби минава
 * като адрес и писмото тръгва от „Записки <noreply@…>“ като цяло, което не е
 * валиден адрес. Resend обаче разбира формата както е, затова само този път
 * разделя.
 */
export function parseAddress(value: string): Address | string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!m) return value.trim();
  const name = m[1]!.replace(/^"|"$/g, '').trim();
  const email = m[2]!.trim();
  return name ? { name, email } : email;
}

/** Само адресът, без името — за показване и за сравнения. */
export function bareAddress(value: string): string {
  const parsed = parseAddress(value);
  return typeof parsed === 'string' ? parsed : parsed.email;
}

/* ── Съдържание на писмата ───────────────────────────────────────────────── */

export function verifyEmail(link: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Потвърди имейла си за Записки',
    text: `Здравей,

Потвърди имейла си, за да завършим регистрацията в Записки:

${link}

Връзката важи 48 часа. Ако не си се регистрирал ти, просто изтрий това писмо.

— Записки`,
    html: shell(
      'Потвърди имейла си',
      `<p>Остава една стъпка, за да завършим регистрацията в Записки.</p>`,
      link,
      'Потвърди имейла',
      'Връзката важи 48 часа. Ако не си се регистрирал ти, просто изтрий това писмо.',
    ),
  };
}

/** Покана в организация. Казва КОЙ кани и КЪДЕ — иначе изглежда като фишинг. */
export function inviteEmail(input: {
  orgName: string;
  invitedBy: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const who = input.invitedBy ? ` от ${input.invitedBy}` : '';
  return {
    subject: `Покана за „${input.orgName}“ в Записки`,
    text: `Здравей,

Получаваш покана${who} да се присъединиш към „${input.orgName}“ в Записки.
Като член ще можеш да ползваш общите източници на организацията в своите тетрадки.

${input.link}

Връзката важи 14 дни и е само за твоя имейл. Ако не очакваш това, изтрий писмото.

— Записки`,
    html: shell(
      `Покана за „${escapeHtml(input.orgName)}“`,
      `<p>Получаваш покана${who ? ` от <strong>${escapeHtml(input.invitedBy)}</strong>` : ''} да се присъединиш към <strong>${escapeHtml(input.orgName)}</strong>.</p>
       <p>Като член ще можеш да ползваш общите източници на организацията в своите тетрадки.</p>`,
      input.link,
      'Приеми поканата',
      'Връзката важи 14 дни и е само за твоя имейл. Ако не очакваш това, изтрий писмото.',
    ),
  };
}

export function resetEmail(link: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Нова парола за Записки',
    text: `Здравей,

Поискана е нова парола за профила ти в Записки:

${link}

Връзката важи 2 часа. Ако не си я поискал ти, не прави нищо — паролата остава същата.

— Записки`,
    html: shell(
      'Нова парола',
      `<p>Поискана е нова парола за профила ти в Записки.</p>`,
      link,
      'Задай нова парола',
      'Връзката важи 2 часа. Ако не си я поискал ти, не прави нищо — паролата остава същата.',
    ),
  };
}

/**
 * Съобщение от формата за контакт.
 *
 * Подателят остава `EMAIL_FROM` — чуждият адрес в `from` не минава проверките на
 * домейна. Адресът на човека влиза в `Reply-To`, така че „Отговори“ отива при
 * него, и се изписва в тялото, за да се вижда и в списъка с писма.
 */
export function contactEmail(input: {
  name: string;
  email: string;
  message: string;
  /** Профилът, ако човекът е бил влязъл — понякога е единственият надежден белег. */
  userId?: string | null;
}): { subject: string; html: string; text: string; replyTo: string } {
  const who = input.name || input.email;
  const meta = input.userId ? `\nПрофил: ${input.userId}` : '';
  return {
    replyTo: input.email,
    subject: `Съобщение от ${who} — Записки`,
    text: `От: ${input.name || '(без име)'} <${input.email}>${meta}

${input.message}`,
    html: `<!doctype html>
<html lang="bg"><body style="margin:0;padding:24px 16px;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1a17">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fffdfa;border:1px solid #e3ddd3;border-radius:16px">
    <tr><td style="padding:26px">
      <div style="font-size:13px;color:#6b6560;margin-bottom:14px">
        От <strong>${escapeHtml(input.name || '(без име)')}</strong><br />
        <a href="mailto:${escapeHtml(input.email)}" style="color:#7a2230">${escapeHtml(input.email)}</a>
        ${input.userId ? `<br />Профил: <code>${escapeHtml(input.userId)}</code>` : ''}
      </div>
      <div style="font-size:15px;line-height:1.65;white-space:pre-wrap">${escapeHtml(input.message)}</div>
    </td></tr>
  </table>
</body></html>`,
  };
}

/** Съдържанието идва от непознат — всичко минава през това, преди да стане HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Прост шаблон в цветовете на приложението; без външни ресурси. */
function shell(
  heading: string,
  intro: string,
  link: string,
  button: string,
  footer: string,
): string {
  return `<!doctype html>
<html lang="bg"><body style="margin:0;padding:32px 16px;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1a17">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fffdfa;border:1px solid #e3ddd3;border-radius:16px">
    <tr><td style="padding:32px">
      <div style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#7a2230;color:#faf7f2;font-weight:700;font-family:Georgia,serif">З</div>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:600;margin:18px 0 10px">${heading}</h1>
      <div style="font-size:15px;line-height:1.6;color:#6b6560">${intro}</div>
      <p style="margin:26px 0">
        <a href="${link}" style="display:inline-block;background:#7a2230;color:#faf7f2;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:99px">${button}</a>
      </p>
      <p style="font-size:12.5px;line-height:1.6;color:#9a938c;margin:0">
        ${footer}<br /><br />
        Ако бутонът не работи, отвори този адрес:<br />
        <span style="word-break:break-all;color:#7a2230">${link}</span>
      </p>
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#9a938c;text-align:center">Записки — тетрадки с източници и въпроси</p>
</body></html>`;
}
