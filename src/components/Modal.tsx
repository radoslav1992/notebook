import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** `wide` suits the source/note readers; `default` suits forms. */
  size?: 'default' | 'wide';
}

export function Modal({ title, onClose, children, footer, size = 'default' }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-canvas shadow-2xl animate-fade-up sm:rounded-3xl ${
          size === 'wide' ? 'sm:max-w-3xl' : 'sm:max-w-xl'
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="truncate text-base font-medium">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
