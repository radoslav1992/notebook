import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Icon>
);

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12h13" />
    <path d="m12.5 6.5 5.5 5.5-5.5 5.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
  </Icon>
);

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Icon>
);

export const PdfIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8.5 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5" />
    <path d="M13 17v-4h1a1.6 1.6 0 0 1 1.6 1.6v.8A1.6 1.6 0 0 1 14 17z" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </Icon>
);

export const YouTubeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="3.5" />
    <path d="m11 10 4 2-4 2z" fill="currentColor" stroke="none" />
  </Icon>
);

export const TextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6h14M5 11h14M5 16h9" />
  </Icon>
);

export const NoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9.8L14.3 20H6.5A1.5 1.5 0 0 1 5 18.5z" />
    <path d="M19 15h-4.5v5" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9z" />
    <path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8z" />
  </Icon>
);

export const AudioIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 10.5v3" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const StudyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H12v16H6.5A2.5 2.5 0 0 1 4 17.5z" />
    <path d="M20 6.5A2.5 2.5 0 0 0 17.5 4H12v16h5.5a2.5 2.5 0 0 0 2.5-2.5z" />
  </Icon>
);

export const BriefIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M3.5 12h17" />
  </Icon>
);

export const FaqIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.8 9.6a2.2 2.2 0 1 1 2.9 2.1c-.5.2-.7.6-.7 1.1v.4" />
    <path d="M12 16.6h.01" />
  </Icon>
);

export const TimelineIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5v17" />
    <circle cx="6" cy="8" r="1.8" />
    <circle cx="6" cy="16" r="1.8" />
    <path d="M10 8h9M10 16h6" />
  </Icon>
);

export const MindMapIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="10" width="6" height="4" rx="1.4" />
    <rect x="15" y="4.5" width="6" height="4" rx="1.4" />
    <rect x="15" y="15.5" width="6" height="4" rx="1.4" />
    <path d="M9 12h3v-5.5h3M12 12v5.5h3" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 7 5 5-5 5" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14 7-5 5 5 5" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 1 0-.7 4.5" />
    <path d="M20 5.5V11h-5.5" />
  </Icon>
);

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16V5" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="M4.5 15.5v2A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
  </Icon>
);

export const NotebookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4z" />
    <path d="M9 4v16" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v5M12 16h.01" />
  </Icon>
);

export const SaveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5h8.5L19.5 8.5V18a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5z" />
    <path d="M8.5 4.5v5h6v-5M8.5 19.5v-5h7v5" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5v11" />
    <path d="m7.5 11 4.5 4.5 4.5-4.5" />
    <path d="M4.5 16v1.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V16" />
  </Icon>
);
