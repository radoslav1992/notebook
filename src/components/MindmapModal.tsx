import type { CSSProperties } from 'preact';
import type { Mindmap } from '~/lib/types';

interface Props {
  mindmap: Mindmap | null;
  busy: boolean;
  error: string;
  canGenerate: boolean;
  onGenerate: () => void;
  onPickNode: (label: string) => void;
  onClose: () => void;
}

/** Ъглите на лъчите и местата на възлите, точно както в дизайна. */
const SPOKES = [-150, -90, -30, 30, 90, 150];

const POSITIONS: CSSProperties[] = [
  { left: '22%', top: '16%' },
  { left: '50%', top: '6%', transform: 'translateX(-50%)' },
  { right: '20%', top: '16%' },
  { right: '18%', bottom: '16%' },
  { left: '50%', bottom: '5%', transform: 'translateX(-50%)' },
  { left: '20%', bottom: '16%' },
];

export default function MindmapModal({
  mindmap,
  busy,
  error,
  canGenerate,
  onGenerate,
  onPickNode,
  onClose,
}: Props) {
  return (
    <div
      class="overlay dim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Мисловна карта"
    >
      <div class="mindmap" onClick={(e) => e.stopPropagation()}>
        <div class="mindmap-head">
          <h2 class="mindmap-title">Мисловна карта</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {mindmap && !busy && (
              <button
                class="btn btn-quiet"
                onClick={onGenerate}
                disabled={!canGenerate}
                title={canGenerate ? '' : 'Избери поне един обработен източник'}
              >
                Обнови
              </button>
            )}
            <button class="modal-x" onClick={onClose} aria-label="Затвори">
              ×
            </button>
          </div>
        </div>

        {busy ? (
          <div class="mindmap-blank">
            <span class="spinner" style={{ width: '20px', height: '20px' }} />
            <div>Търся темите в източниците…</div>
          </div>
        ) : !mindmap ? (
          <div class="mindmap-blank">
            <div class="serif" style={{ fontSize: '20px', color: 'var(--ink)' }}>
              Още няма карта на темите
            </div>
            <p style={{ maxWidth: '44ch', margin: 0, lineHeight: 1.6 }}>
              Ще прегледам избраните източници и ще извадя централната тема с шест подтеми. Кликването
              на подтема я задава като въпрос в чата.
            </p>
            {error && <div class="banner-error" style={{ margin: 0 }}>{error}</div>}
            <button
              class="btn btn-primary"
              style={{ padding: '11px 20px' }}
              onClick={onGenerate}
              disabled={!canGenerate}
              title={canGenerate ? '' : 'Избери поне един обработен източник'}
            >
              Направи мисловна карта
            </button>
          </div>
        ) : (
          <div class="mindmap-canvas">
            <div class="mind-center">{mindmap.center}</div>
            {SPOKES.map((deg) => (
              <div key={deg} class="mind-spoke" style={{ transform: `rotate(${deg}deg)` }} />
            ))}
            {mindmap.nodes.slice(0, 6).map((node, i) => (
              <button
                key={node.label}
                class="mind-node"
                style={POSITIONS[i]}
                title={node.hint ?? ''}
                onClick={() => onPickNode(node.label)}
              >
                {node.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
