// How an attachment is rendered and which extraction path it takes. Not a
// column: `attachments` carries the real `mime`, and this is derived from it
// wherever a shape is needed (the composer's tile, the chat bubble, the
// pipeline's per-attachment dispatch). Deriving it means one file's face can
// never disagree with the bytes it holds.

export const ATTACHMENT_FACES = ["image", "pdf", "audio", "file"] as const;
export type AttachmentFace = (typeof ATTACHMENT_FACES)[number];

export function faceForMime(mime: string): AttachmentFace {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

/** Files whose bytes are their own text: decoded rather than described. */
const TEXTUAL_RE =
  /^text\/|^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql|csv)/;

export function isTextualMime(mime: string): boolean {
  return TEXTUAL_RE.test(mime);
}

/** The fence language for a textual file's `content_md` block (plan §5.3). */
export function fenceLanguage(mime: string, filename: string): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext) return ext;
  if (mime.startsWith("text/")) return mime.slice(5);
  const sub = mime.split("/")[1];
  return sub ?? "";
}
