import { useState } from 'react';
import type { MindMapNode } from '~/lib/studio';
import { ChevronDownIcon, ChevronRightIcon } from './icons';

/**
 * Renders the generated mind map as a collapsible tree. A tree beats a
 * force-directed graph here: it stays readable in a narrow panel and keeps the
 * hierarchy the model actually produced.
 */
export function MindMap({ root }: { root: MindMapNode }) {
  return (
    <div className="text-sm">
      <div className="mb-3 inline-flex items-center gap-2 rounded-xl bg-accent-soft px-3.5 py-2 font-medium text-accent-soft-ink">
        {root.label}
      </div>
      <ul className="space-y-1">
        {(root.children ?? []).map((child, index) => (
          <Branch key={index} node={child} depth={0} />
        ))}
      </ul>
    </div>
  );
}

const DEPTH_TINT = ['border-accent', 'border-line-strong', 'border-line'];

function Branch({ node, depth }: { node: MindMapNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;

  return (
    <li className={`border-l-2 pl-3 ${DEPTH_TINT[Math.min(depth, DEPTH_TINT.length - 1)]}`}>
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button
            className="btn-icon size-6 shrink-0"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          </button>
        ) : (
          <span className="mt-2.5 ml-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
        )}
        <span className={`py-1 ${depth === 0 ? 'font-medium text-ink' : 'text-muted'}`}>
          {node.label}
        </span>
      </div>

      {hasChildren && open && (
        <ul className="mt-0.5 space-y-1 pb-1">
          {children.map((child, index) => (
            <Branch key={index} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
