import {
  ArrowUpIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  InboxIcon,
  LinkIcon,
  LoaderIcon,
  LogOutIcon,
  MenuIcon,
  MicIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  StickyNoteIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

// Lucide icons behind a name-keyed registry: one place for the shared stroke
// weight, and string keys keep the kind→icon mapping below expressible.

const ICONS = {
  note: StickyNoteIcon,
  link: LinkIcon,
  image: ImageIcon,
  pdf: FileTextIcon,
  file: FileIcon,
  star: StarIcon,
  trash: Trash2Icon,
  tag: TagIcon,
  search: SearchIcon,
  x: XIcon,
  plus: PlusIcon,
  external: ExternalLinkIcon,
  send: ArrowUpIcon,
  mic: MicIcon,
  retry: RefreshCwIcon,
  spinner: LoaderIcon,
  logout: LogOutIcon,
  inbox: InboxIcon,
  sparkles: SparklesIcon,
  menu: MenuIcon,
  sidebar: PanelLeftIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className = "size-4",
  filled = false,
}: {
  name: IconName;
  className?: string;
  filled?: boolean;
}) {
  const LucideIcon = ICONS[name];
  return (
    <LucideIcon
      className={className}
      strokeWidth={1.6}
      fill={filled ? "currentColor" : "none"}
      aria-hidden
    />
  );
}

export const KIND_ICON = {
  note: "note",
  link: "link",
  image: "image",
  pdf: "pdf",
  file: "file",
} as const;
