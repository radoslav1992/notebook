import type { JSX } from 'preact';

type Props = { size?: number; class?: string };

export function SearchIcon({ size = 15 }: Props): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function DocIcon({ size = 24 }: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    >
      <path d="M5 4h9l5 5v11H5z" />
      <path d="M14 4v5h5" />
      <path d="M8 13h7M8 16.5h5" />
    </svg>
  );
}

export function ArrowIcon({ size = 17 }: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 12h13M12 5l7 7-7 7" />
    </svg>
  );
}
