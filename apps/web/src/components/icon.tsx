import {
  ArrowUpIcon,
  CheckIcon,
  CirclePauseIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  InboxIcon,
  LinkIcon,
  ListTodoIcon,
  LoaderIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  StickyNoteIcon,
  SunIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

// Lucide icons behind a name-keyed registry: one place for the shared stroke
// weight, and string keys keep the kind→icon mapping below expressible.

const ICONS = {
  note: StickyNoteIcon,
  todo: ListTodoIcon,
  address: MapPinIcon,
  link: LinkIcon,
  image: ImageIcon,
  pdf: FileTextIcon,
  file: FileIcon,
  star: StarIcon,
  check: CheckIcon,
  copy: CopyIcon,
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
  sun: SunIcon,
  moon: MoonIcon,
  monitor: MonitorIcon,
  alert: TriangleAlertIcon,
  pause: CirclePauseIcon,
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
  todo: "todo",
  address: "address",
  link: "link",
  image: "image",
  pdf: "pdf",
  file: "file",
} as const;
