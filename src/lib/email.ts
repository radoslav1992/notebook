/**
 * Изпращане на имейл през Resend (обикновен REST, работи във Workers).
 *
 * Ако `RESEND_API_KEY` липсва, писмата не се пращат, а връзката се записва в
 * лога — така локалната работа не изисква доставчик. В production без ключ
 * потвърждаването на имейл и новата парола не работят; `docs/SETUP.md` го казва.
 */

const RESEND_URL = 'https://api.resend.com/emails';

export interface Mailer {
  readonly enabled: boolean;
  send(input: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

export function mailer(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): Mailer {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || 'Записки <onboarding@resend.dev>';

  return {
    enabled: Boolean(key),
    async send({ to, subject, html, text }) {
      if (!key) {
        console.warn(`[zapiski:email] няма RESEND_API_KEY — писмото до ${to} не е изпратено`);
        console.warn(`[zapiski:email] ${subject}\n${text}`);
        return;
      }
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Имейлът не беше изпратен (${res.status}): ${detail.slice(0, 300)}`);
      }
    },
  };
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
