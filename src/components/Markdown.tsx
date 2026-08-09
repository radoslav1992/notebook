import { Fragment, type ReactNode } from 'react';

interface MarkdownProps {
  text: string;
  /** Renders `[n]` markers as clickable citation chips. */
  onCitation?: (index: number) => void;
  className?: string;
}

/**
 * A small, dependency-free markdown renderer.
 *
 * It covers exactly what the model emits — headings, lists, emphasis, code,
 * quotes, rules, links — plus the `[n]` citation markers we splice into
 * grounded answers. Output is React elements, never raw HTML, so model text can
 * never inject markup.
 */
export function Markdown({ text, onCitation, className }: MarkdownProps) {
  return (
    <div className={`prose-nblm ${className ?? ''}`}>{renderBlocks(text, onCitation)}</div>
  );
}

const INLINE = /(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\[\d{1,3}\])/g;

function renderInline(text: string, onCitation?: (index: number) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    last = start + token.length;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (/^\[\d{1,3}\]$/.test(token)) {
      const index = Number(token.slice(1, -1));
      nodes.push(
        <button
          key={key++}
          type="button"
          onClick={() => onCitation?.(index)}
          disabled={!onCitation}
          title={onCitation ? `Open source for citation ${index}` : undefined}
          className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full
                     bg-accent-soft px-1 align-[0.1em] text-[0.68rem] font-medium text-accent-soft-ink
                     transition-opacity enabled:hover:opacity-80 enabled:cursor-pointer"
        >
          {index}
        </button>,
      );
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlocks(source: string, onCitation?: (index: number) => void): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let key = 0;
  let i = 0;

  const inline = (text: string) => renderInline(text, onCitation);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) body.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre key={key++}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const Tag = (['h1', 'h2', 'h3'] as const)[level - 1];
      out.push(<Tag key={key++}>{inline(heading[2].trim())}</Tag>);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(<blockquote key={key++}>{inline(body.join(' '))}</blockquote>);
      continue;
    }

    // Lists
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const ordered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const pattern = isOrdered ? ordered : bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const match = pattern.exec(lines[i]);
        if (match) {
          items.push(match[1]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          // Wrapped continuation of the previous item.
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      const children = items.map((item, index) => <li key={index}>{inline(item)}</li>);
      out.push(
        isOrdered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>,
      );
      continue;
    }

    // Paragraph — consume until a blank line or the start of another block.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !ordered.test(lines[i])
    ) {
      body.push(lines[i].trim());
      i++;
    }
    out.push(<p key={key++}>{inline(body.join(' '))}</p>);
  }

  return out.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}
