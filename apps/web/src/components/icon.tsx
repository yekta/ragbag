import type { AttachmentFace } from "@ragbag/shared";
import {
  ArrowUpIcon,
  AudioLinesIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CirclePauseIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  ImageIcon,
  InboxIcon,
  LandmarkIcon,
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
  PencilIcon,
  PhoneIcon,
  PlayIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
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
  bank: LandmarkIcon,
  book: BookOpenIcon,
  check: CheckIcon,
  copy: CopyIcon,
  down: ChevronDownIcon,
  download: DownloadIcon,
  edit: PencilIcon,
  external: ExternalLinkIcon,
  file: FileIcon,
  filePlus: FilePlusIcon,
  image: ImageIcon,
  inbox: InboxIcon,
  left: ChevronLeftIcon,
  link: LinkIcon,
  logout: LogOutIcon,
  mail: MailIcon,
  menu: MenuIcon,
  mic: MicIcon,
  monitor: MonitorIcon,
  moon: MoonIcon,
  more: EllipsisIcon,
  package: PackageIcon,
  pause: CirclePauseIcon,
  pdf: FileTextIcon,
  phone: PhoneIcon,
  play: PlayIcon,
  plus: PlusIcon,
  receipt: ReceiptIcon,
  retry: RefreshCwIcon,
  right: ChevronRightIcon,
  search: SearchIcon,
  send: ArrowUpIcon,
  settings: SettingsIcon,
  sidebar: PanelLeftIcon,
  sparkles: SparklesIcon,
  spinner: LoaderIcon,
  star: StarIcon,
  stop: SquareIcon,
  sun: SunIcon,
  tag: TagIcon,
  trash: Trash2Icon,
  up: ChevronUpIcon,
  x: XIcon,
} as const;

export type IconName = keyof typeof ICONS;

/**
 * What a type may pick from in settings: icons that stand for a thing, not for
 * a control. A spinner or a close cross is chrome, and no kind of thing is one.
 */
export const TYPE_ICONS: readonly IconName[] = [
  "sparkles",
  "link",
  "address",
  "package",
  "phone",
  "mail",
  "receipt",
  "bank",
  "book",
  "image",
  "file",
  "pdf",
  "audio",
  "star",
  "tag",
  "inbox",
];

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
 * What a file's own page calls it.
 *
 * Finer than the rail, which has two rows for four faces: everything that is
 * not a picture is under "Files" there, because a rail row is a place to go
 * and three of them for the same kind of browsing is three near-empty lists.
 * A page is about one file, so it can say which of them it is, and "PDF" and
 * "Audio" are what a person would call the thing in front of them.
 */
export const FACE_LABEL = {
  image: "Image",
  pdf: "PDF",
  audio: "Audio",
  file: "File",
} as const satisfies Record<AttachmentFace, string>;

/**
 * An icon named by a type rather than by this build.
 *
 * A declared type's `icon` is a string in Postgres, so it can name an icon this
 * build does not have: a typo, or one a newer build ships. Falling back to the
 * generic sparkle is not an error worth crashing a card over (plan §3.3).
 */
export function iconNamed(name: string | undefined): IconName {
  return name && name in ICONS ? (name as IconName) : "sparkles";
}
