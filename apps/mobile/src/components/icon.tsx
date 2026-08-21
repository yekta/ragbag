import type { TAttachmentFace } from "@ragbag/shared";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";
import type { AndroidSymbol } from "expo-symbols";
import { ActivityIndicator, type ColorValue } from "react-native";

// The same icon vocabulary as apps/web/src/components/icon.tsx, drawn by each
// platform's own icon set instead of by one library on both.
//
// That is the whole reason this file is a two-column registry rather than a
// copy of the web one with lucide swapped for something else. An SF Symbol is
// not a lucide glyph that happens to be shipped by Apple: it is the icon iOS
// draws for that idea, at the optical weight the system uses, matching every
// icon in the navigation bar next to it. Material Symbols are the same promise
// on Android. A single third-party set would look imported on both.
//
// The keys are the web app's, unchanged and deliberately so: they are what a
// user's entity type stores in its `icon` column, so the two shells have to
// agree on the name even though they disagree on the drawing.

type TSymbol = { ios: SFSymbol; android: AndroidSymbol };

const ICONS = {
  address: { ios: "mappin.and.ellipse", android: "place" },
  alert: { ios: "exclamationmark.triangle", android: "warning" },
  audio: { ios: "waveform", android: "graphic_eq" },
  bank: { ios: "building.columns", android: "account_balance" },
  book: { ios: "book", android: "menu_book" },
  check: { ios: "checkmark", android: "check" },
  copy: { ios: "doc.on.doc", android: "content_copy" },
  details: { ios: "list.bullet.rectangle", android: "list_alt" },
  down: { ios: "chevron.down", android: "expand_more" },
  download: { ios: "arrow.down.circle", android: "download" },
  edit: { ios: "pencil", android: "edit" },
  external: { ios: "arrow.up.right.square", android: "open_in_new" },
  file: { ios: "doc", android: "draft" },
  filePlus: { ios: "doc.badge.plus", android: "note_add" },
  image: { ios: "photo", android: "image" },
  inbox: { ios: "tray", android: "inbox" },
  left: { ios: "chevron.left", android: "chevron_left" },
  link: { ios: "link", android: "link" },
  logout: { ios: "rectangle.portrait.and.arrow.right", android: "logout" },
  mail: { ios: "envelope", android: "mail" },
  menu: { ios: "line.3.horizontal", android: "menu" },
  mic: { ios: "mic", android: "mic" },
  monitor: { ios: "desktopcomputer", android: "computer" },
  moon: { ios: "moon", android: "dark_mode" },
  more: { ios: "ellipsis", android: "more_horiz" },
  package: { ios: "shippingbox", android: "inventory_2" },
  pause: { ios: "pause.circle", android: "pause_circle" },
  pdf: { ios: "doc.text", android: "description" },
  phone: { ios: "phone", android: "call" },
  play: { ios: "play.fill", android: "play_arrow" },
  plus: { ios: "plus", android: "add" },
  receipt: { ios: "receipt", android: "receipt_long" },
  retry: { ios: "arrow.clockwise", android: "refresh" },
  right: { ios: "chevron.right", android: "chevron_right" },
  search: { ios: "magnifyingglass", android: "search" },
  send: { ios: "arrow.up", android: "arrow_upward" },
  settings: { ios: "gearshape", android: "settings" },
  sidebar: { ios: "sidebar.left", android: "left_panel_open" },
  sparkles: { ios: "sparkles", android: "auto_awesome" },
  // Never drawn as a symbol: see the ActivityIndicator branch below.
  spinner: { ios: "circle.dotted", android: "progress_activity" },
  star: { ios: "star", android: "star" },
  stop: { ios: "stop.fill", android: "stop" },
  sun: { ios: "sun.max", android: "light_mode" },
  tag: { ios: "tag", android: "sell" },
  trash: { ios: "trash", android: "delete" },
  up: { ios: "chevron.up", android: "expand_less" },
  x: { ios: "xmark", android: "close" },
} as const satisfies Record<string, TSymbol>;

export type TIconName = keyof typeof ICONS;

/**
 * What a type may pick from in settings: icons that stand for a thing, not for
 * a control. A spinner or a close cross is chrome, and no kind of thing is one.
 */
export const TYPE_ICONS: readonly TIconName[] = [
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

export type TIconProps = {
  name: TIconName;
  /** Points, which are CSS pixels here; 16 matches the web's `size-4`. */
  size?: number;
  color?: ColorValue;
  /** The filled variant, for a favourited star or a played state. */
  filled?: boolean;
};

export function Icon({ name, size = 16, color, filled = false }: TIconProps) {
  // A spinner is motion, not a glyph. iOS has no SF Symbol that spins on its
  // own and Android's `progress_activity` is a still arc, so both platforms
  // get the control that already knows how to turn, at the platform's own
  // rate. Kept inside the registry so callers say `name="spinner"` here
  // exactly as they do on web.
  if (name === "spinner") {
    return <ActivityIndicator size="small" color={color} />;
  }
  const symbol = ICONS[name];
  return (
    <SymbolView
      name={{ ios: filled ? filledIos(symbol.ios) : symbol.ios, android: symbol.android }}
      size={size}
      tintColor={color}
      weight="regular"
      // Every symbol in this registry is single-colour; the tint decides it.
      type="monochrome"
    />
  );
}

/**
 * SF Symbols name their filled variants by suffix, which is a convention
 * rather than a separate icon: `star` and `star.fill` are the same symbol at
 * two weights of ink. Symbols already filled (`play.fill`) are left alone.
 */
function filledIos(name: SFSymbol): SFSymbol {
  return (name.endsWith(".fill") ? name : `${name}.fill`) as SFSymbol;
}

/** The face an attachment shows in a list or a sidebar row. */
export const FACE_ICON = {
  image: "image",
  pdf: "pdf",
  audio: "audio",
  file: "file",
} as const satisfies Record<TAttachmentFace, TIconName>;

/**
 * What a file's own page calls it.
 *
 * Finer than the sidebar, which has two rows for four faces: everything that
 * is not a picture is under "Files" there, because a sidebar row is a place to
 * go and three of them for the same kind of browsing is three near-empty
 * lists. A page is about one file, so it can say which of them it is.
 */
export const FACE_LABEL = {
  image: "Image",
  pdf: "PDF",
  audio: "Audio",
  file: "File",
} as const satisfies Record<TAttachmentFace, string>;

/**
 * An icon named by a type rather than by this build.
 *
 * A declared type's `icon` is a string in Postgres, so it can name an icon this
 * build does not have: a typo, or one a newer build ships. Falling back to the
 * generic sparkle is not an error worth crashing a card over (plan §3.3).
 */
export function iconNamed(name: string | undefined): TIconName {
  return name && name in ICONS ? (name as TIconName) : "sparkles";
}
