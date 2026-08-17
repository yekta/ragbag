import { ENTITY_DEFINITIONS } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import {
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  CirclePauseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  ImageIcon,
  InboxIcon,
  LinkIcon,
  LoaderIcon,
  LogOutIcon,
  MailIcon,
  MapPinIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  PanelLeftIcon,
  PhoneIcon,
  PlayIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  StarIcon,
  SunIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

// Lucide icons behind a name-keyed registry: one place for the shared stroke
// weight, and string keys keep the entity registry's `icon` field expressible
// without @ragbag/shared ever importing React.

const ICONS = {
  address: MapPinIcon,
  alert: TriangleAlertIcon,
  audio: AudioLinesIcon,
  check: CheckIcon,
  copy: CopyIcon,
  dismiss: EyeOffIcon,
  download: DownloadIcon,
  external: ExternalLinkIcon,
  file: FileIcon,
  filePlus: FilePlusIcon,
  image: ImageIcon,
  inbox: InboxIcon,
  link: LinkIcon,
  logout: LogOutIcon,
  mail: MailIcon,
  menu: MenuIcon,
  mic: MicIcon,
  monitor: MonitorIcon,
  moon: MoonIcon,
  package: PackageIcon,
  pause: CirclePauseIcon,
  pdf: FileTextIcon,
  phone: PhoneIcon,
  play: PlayIcon,
  plus: PlusIcon,
  receipt: ReceiptIcon,
  retry: RefreshCwIcon,
  search: SearchIcon,
  send: ArrowUpIcon,
  sidebar: PanelLeftIcon,
  sparkles: SparklesIcon,
  spinner: LoaderIcon,
  star: StarIcon,
  stop: SquareIcon,
  sun: SunIcon,
  tag: TagIcon,
  trash: Trash2Icon,
  x: XIcon,
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

/** The face an attachment shows in a list or a rail row. */
export const FACE_ICON = {
  image: "image",
  pdf: "pdf",
  audio: "audio",
  file: "file",
} as const satisfies Record<AttachmentFace, IconName>;

/**
 * Per-kind icons, read off the registry.
 *
 * An entry naming an icon this build does not have is not an error worth
 * crashing a card over: a kind can arrive from a newer build, and the generic
 * fallback is exactly what should draw it (plan §3.3).
 */
const ENTITY_ICONS: Record<string, IconName> = Object.fromEntries(
  ENTITY_DEFINITIONS.filter((d) => d.icon in ICONS).map((d) => [d.kind, d.icon as IconName]),
);

export function entityIcon(kind: string): IconName {
  return ENTITY_ICONS[kind] ?? "sparkles";
}
