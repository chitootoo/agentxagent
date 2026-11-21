// biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative icons, hidden from assistive tech
interface IconProps {
  size?: number;
  className?: string;
}

function svgProps({ size = 18, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function ProjectsIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 12a7.5 7.5 0 0 1-8 7.5 9 9 0 0 1-3.2-.7L4 20l1.2-4.1A7.2 7.2 0 0 1 4 12a7.5 7.5 0 0 1 8-7.5A7.5 7.5 0 0 1 20 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m4 11 16-7-7 16-2.5-6.5L4 11Z" />
      <path d="m10.5 13.5 4-4" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m5 12 4.5 4.5L19 6.5" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function FileTextIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  );
}
