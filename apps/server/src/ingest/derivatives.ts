import { log } from "@ragbag/shared";
import type { TBlobVariants } from "@ragbag/shared";
import decodeHeic from "heic-decode";
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
// HEIC needs a second decoder, and the reason is worth writing down because it
// looks like a missing package and is not. sharp runs against the libvips it
// bundles, whose libheif carries AV1 but not HEVC, and it only builds against a
// system libvips when `SHARP_FORCE_GLOBAL_LIBVIPS` is set at INSTALL time,
// against libvips >= 8.18.3, which no Debian or Ubuntu release ships. So a
// HEIC off an iPhone reaches `metadata()` fine (libvips reads the container and
// reports `format: heif, compression: hevc`) and then fails on the pixels with
// "Support for this compression format has not been built in".
//
// `heic-decode` closes it with libheif compiled to WASM: no base image
// requirement at all, which is why it also works in local dev and in the
// acceptance proofs, unlike anything installed with apt. It costs CPU rather
// than configuration (~290ms for a 1.1MP image, so a few seconds for a 12MP
// phone photo), which is the cheapest resource a background worker has.

/**
 * sharp's types are a CommonJS `export =` with a namespace, which this
 * project's `verbatimModuleSyntax` cannot reach into for `sharp.Sharp`.
 * The pipeline itself is what the function returns, so name it that way.
 */
type TSharpImage = ReturnType<typeof sharp>;

/** The long edge of the web-safe transcode. */
const DISPLAY_MAX = 1600;
/** The long edge of the grid thumbnail. */
const THUMB_MAX = 400;
/** thumbhash takes at most 100x100 and wants the aspect preserved. */
const HASH_MAX = 100;

/**
 * One decoded image, upright, plus a factory for fresh sharp pipelines over it.
 *
 * A factory rather than one pipeline: sharp streams are single-use, and the
 * three outputs below (display, thumb, placeholder) each need their own. The
 * dimensions travel with it because the HEVC path learns them from its own
 * decoder rather than from sharp.
 */
export type TImageSource = { open: () => TSharpImage; width: number; height: number };

/** EXIF orientations 5-8 are the quarter turns, which swap width and height. */
function rotatesAxes(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * Get at an image's pixels, whichever decoder can read them.
 *
 * The route is decided by what libvips says the file IS rather than by trying
 * a transcode and catching the failure: `compression: "hevc"` means libvips
 * recognised the container and cannot decode the payload, which is exactly the
 * HEIC case and nothing else. AVIF in the same container family reports `av1`
 * and stays on the sharp path, where it already worked.
 */
export async function openImage(bytes: Uint8Array): Promise<TImageSource> {
  // `failOn: "none"` because a partially-corrupt photo that still decodes is
  // worth a thumbnail; only an undecodable one should reach the failure path.
  const buffer = Buffer.from(bytes);
  const meta = await sharp(buffer, { failOn: "none" }).metadata();

  if (meta.compression === "hevc") {
    const { width, height, data } = await decodeHeic({ buffer });
    // libheif applies the container's own `irot`/`imir` transforms while
    // rendering, so these pixels are already upright and must NOT be rotated
    // again: raw input carries no EXIF for sharp to read anyway.
    const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return {
      open: () => sharp(pixels, { raw: { width, height, channels: 4 } }),
      width,
      height,
    };
  }

  if (!meta.width || !meta.height) throw new Error("the image has no readable dimensions");
  // After `rotate()` the axes may swap, so what goes on the row is what the
  // browser will actually see.
  const swapped = rotatesAxes(meta.orientation);
  return {
    open: () => sharp(buffer, { failOn: "none" }).rotate(),
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
  };
}

export type TImageDerivatives = {
  width: number;
  height: number;
  variants: TBlobVariants;
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
}): Promise<TImageDerivatives> {
  if (!storage) throw new Error("server has no blob storage configured");

  const source = await openImage(input.bytes);

  const display = await source
    .open()
    .resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const thumb = await source
    .open()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 74 })
    .toBuffer();

  await storage.put(variantKey(input.userId, input.sha256, "display"), display, "image/webp");
  await storage.put(variantKey(input.userId, input.sha256, "thumb"), thumb, "image/webp");

  return {
    // The transcode's own dimensions are wrong for the row whenever the source
    // was larger than the cap; the true upright size is what the layout wants.
    width: source.width,
    height: source.height,
    variants: { display: true, thumb: true },
    placeholder: await placeholderFor(source.open()),
  };
}

/**
 * The blurred stand-in that paints while a thumb is fetched (plan §6.5).
 *
 * It lives in the synced row rather than in any cache, which is what makes
 * aggressive eviction invisible: an evicted thumb still paints at the correct
 * geometry with a blurred image and quietly refetches 30 KB. There is no
 * broken state, no grey box and no reflow.
 */
async function placeholderFor(image: TSharpImage): Promise<string | null> {
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
}): Promise<{ variants: TBlobVariants; placeholder: string | null }> {
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
