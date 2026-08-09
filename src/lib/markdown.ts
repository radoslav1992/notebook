/**
 * Съвсем малък markdown → HTML.
 *
 * Първо се екранира целият вход, после се прилагат правилата — така никой
 * HTML от модела или от документ на потребителя не може да стигне до DOM.
 * Поддържа само това, което инструкциите ни искат от модела: заглавия,
 * абзаци, списъци, **удебелено**, *курсив*, `код`.
 */

export function renderMarkdown(input: string): string {
  const escaped = escapeHtml(input.replace(/\r\n?/g, '\n'));
  const blocks = escaped.split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const heading = /^#{2,4}\s+(.*)$/.exec(trimmed);
    if (heading) {
      out.push(`<h3>${inline(heading[1]!)}</h3>`);
      continue;
    }

    const lines = trimmed.split('\n');

    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`);
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    out.push(`<p>${lines.map((l) => inline(l)).join('<br />')}</p>`);
  }

  return out.join('');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
