import type { Extraction, Passage } from '../types';

const DROP_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'iframe',
  'button',
  'select',
];

/**
 * Изтегля уеб страница и я превръща в четим текст.
 * Нарочно е малко и без зависимости: приоритет на <article>/<main>, после
 * махаме навигацията и таговете. Заглавията стават места за цитиране.
 */
export async function extractFromUrl(url: string): Promise<Extraction & { title: string }> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ZapiskiBot/1.0; +https://github.com/radoslav1992/notebook)',
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'accept-language': 'bg,en;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Страницата отговори с ${res.status}.`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const raw = await res.text();

  if (contentType.includes('text/plain') || (!contentType.includes('html') && !/<html/i.test(raw))) {
    const passages = splitIntoPassages(normalizeWhitespace(raw));
    return { passages, pageCount: 0, title: hostOf(url) };
  }

  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? '').trim();
  const body = pickMainRegion(raw);
  const text = htmlToText(body);
  const passages = splitIntoPassages(text);

  return {
    passages,
    pageCount: 0,
    title: title || hostOf(url),
  };
}

export function extractFromPlainText(text: string): Extraction {
  return { passages: splitIntoPassages(normalizeWhitespace(text)), pageCount: 0 };
}

/* ── вътрешни ────────────────────────────────────────────────────────────── */

function pickMainRegion(html: string): string {
  for (const tag of ['article', 'main']) {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
    if (m?.[1] && m[1].length > 600) return m[1];
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

function htmlToText(html: string): string {
  let out = html;
  for (const tag of DROP_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  // Заглавията стават собствен абзац, за да оцелеят като места за цитиране.
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, inner) => `\n\n## ${stripTags(inner)}\n\n`);
  out = out.replace(/<li\b[^>]*>/gi, '\n• ');
  out = out.replace(/<\/(p|div|section|tr|ul|ol|li|blockquote|h[1-6])>/gi, '\n\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = stripTags(out);
  return normalizeWhitespace(decodeEntities(out));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  bull: '•',
  deg: '°',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

/**
 * Разбива дълъг текст на пасажи по заглавия и абзаци.
 * Мястото за цитиране е „раздел N“ или най-близкото заглавие.
 */
export function splitIntoPassages(text: string, targetChars = 1400): Passage[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const passages: Passage[] = [];
  let buffer: string[] = [];
  let heading = '';
  let section = 1;

  const flush = () => {
    const joined = buffer.join('\n\n').trim();
    if (!joined) return;
    passages.push({
      text: joined,
      page: section,
      locator: heading ? `раздел „${truncate(heading, 40)}“` : `раздел ${section}`,
    });
    section++;
    buffer = [];
  };

  for (const p of paragraphs) {
    const headingMatch = /^#{1,3}\s+(.*)$/.exec(p);
    if (headingMatch) {
      if (buffer.length > 0) flush();
      heading = headingMatch[1]!.trim();
      continue;
    }
    buffer.push(p);
    if (buffer.join('\n\n').length >= targetChars) flush();
  }
  flush();

  return passages;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
