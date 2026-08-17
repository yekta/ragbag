import { log } from "@ragbag/shared";
import type { BlobVariants } from "@ragbag/shared";
import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";
import { storage, variantKey } from "../blobs/storage.js";

// Derivatives (plan §6.2), generated server-side during phase A and written
// straight with `storage.put`, so they never go through the presign path.
//
//   <user_id>/<sha256>          original, exactly as sent, never touched
//   <user_id>/<sha256>/display  web-safe transcode, EXIF baked in, ~1600px
//   <user_id>/<sha256>/thumb    ~400px webp for grids
//
// The original bytes are always kept: "exactly as it was sent" means the
// original survives, and the transcode is what browsers actually render.
//
// HEIC is transcoded here rather than on the client. Client-side burns phone
// battery, cannot fix files that arrive by other paths, and would mean the
// original never reaches the server. The same pass bakes in EXIF orientation
// (we are re-encoding anyway) and reads true dimensions.
//
// This needs libvips built with libheif. sharp's own prebuilt binary carries
// AVIF but not HEIC, so the deploy image supplies one that does; where it does
// not, the decode throws and the caller treats it as a soft failure with a
// note, exactly like a failed AI stage. The original still uploads, still
// downloads, and still opens in anything that can read it.

/**
 * sharp's types are a CommonJS `export =` with a namespace, which this
 * project's `verbatimModuleSyntax` cannot reach into for `sharp.Sharp`.
 * The pipeline itself is what the function returns, so name it that way.
 */
type SharpImage = ReturnType<typeof sharp>;

/** The long edge of the web-safe transcode. */
const DISPLAY_MAX = 1600;
/** The long edge of the grid thumbnail. */
const THUMB_MAX = 400;
/** thumbhash takes at most 100x100 and wants the aspect preserved. */
const HASH_MAX = 100;

export type ImageDerivatives = {
  width: number;
  height: number;
  variants: BlobVariants;
  /** thumbhash, base64. Lives on the synced row, not in any cache (§6.5). */
  placeholder: string | null;
};

/**
 * Transcode, thumbnail and measure one image, writing both derivatives under
 * keys derived from the source sha. Idempotent: a re-run overwrites the same
 * two objects, so there is no bookkeeping to get wrong.
 */
export async function buildImageDerivatives(input: {
  bytes: Uint8Array;
  userId: string;
  sha256: string;
}): Promise<ImageDerivatives> {
  if (!storage) throw new Error("server has no blob storage configured");

  // `failOn: "none"` because a partially-corrupt photo that still decodes is
  // worth a thumbnail; only an undecodable one should reach the caller's
  // failure path.
  const image = sharp(Buffer.from(input.bytes), { failOn: "none" });
  const meta = await image.metadata();
  // After `rotate()` (EXIF applied) width/height may swap, so the dimensions
  // that go on the row are the ones the browser will actually see.
  const upright = sharp(Buffer.from(input.bytes), { failOn: "none" }).rotate();

  const display = await upright
    .clone()
    .resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const thumb = await upright
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 74 })
    .toBuffer();

  await storage.put(variantKey(input.userId, input.sha256, "display"), display.data, "image/webp");
  await storage.put(variantKey(input.userId, input.sha256, "thumb"), thumb, "image/webp");

  return {
    // The display transcode's own dimensions are wrong for the row when the
    // source was larger than the cap; the true (upright) size is what the
    // layout wants, so it comes from the metadata with the rotation applied.
    width: rotatesAxes(meta.orientation) ? (meta.height ?? 0) : (meta.width ?? 0),
    height: rotatesAxes(meta.orientation) ? (meta.width ?? 0) : (meta.height ?? 0),
    variants: { display: true, thumb: true },
    placeholder: await placeholderFor(upright.clone()),
  };
}

/** EXIF orientations 5-8 are the quarter turns, which swap width and height. */
function rotatesAxes(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * The blurred stand-in that paints while a thumb is fetched (plan §6.5).
 *
 * It lives in the synced row rather than in any cache, which is what makes
 * aggressive eviction invisible: an evicted thumb still paints at the correct
 * geometry with a blurred image and quietly refetches 30 KB. There is no
 * broken state, no grey box and no reflow.
 */
async function placeholderFor(image: SharpImage): Promise<string | null> {
  try {
    const { data, info } = await image
      .resize({ width: HASH_MAX, height: HASH_MAX, fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hash = rgbaToThumbHash(info.width, info.height, data);
    return Buffer.from(hash).toString("base64");
  } catch (err) {
    // A placeholder is a nicety; the picture is the point.
    log.debug("could not compute a placeholder", { err: String(err) });
    return null;
  }
}

/**
 * Store a PDF's first page as its thumb (plan §6.2). The rasterizer exists
 * only for this: OCR does not need it, because the model renders the pages
 * itself, but nothing hands us back a page image for the grid.
 */
export async function storePageThumb(input: {
  png: Uint8Array;
  userId: string;
  sha256: string;
}): Promise<{ variants: BlobVariants; placeholder: string | null }> {
  if (!storage) throw new Error("server has no blob storage configured");
  const page = sharp(Buffer.from(input.png), { failOn: "none" });
  const thumb = await page
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  await storage.put(variantKey(input.userId, input.sha256, "thumb"), thumb, "image/webp");
  return { variants: { thumb: true }, placeholder: await placeholderFor(page.clone()) };
}
