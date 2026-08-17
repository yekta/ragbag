import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { openImage } from "./derivatives.js";

// `openImage` is where the two decoders meet (see derivatives.ts): libvips for
// everything it can read, and libheif-via-WASM for the HEVC it cannot. What is
// asserted here is the part that can be built in code; the HEVC branch was
// verified against a real HEIC (1280x854 in ~290ms to decode, both variants
// written as webp) and is not reproducible without an HEVC encoder, which
// nothing in this repo has.

const green = { r: 30, g: 140, b: 110 };

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: green } })
    .png()
    .toBuffer();
}

describe("openImage", () => {
  it("reports the dimensions the browser will see", async () => {
    const source = await openImage(await png(1200, 400));
    expect([source.width, source.height]).toEqual([1200, 400]);
  });

  it("swaps the axes for a quarter-turn EXIF orientation", async () => {
    // An iPhone shooting in portrait writes landscape pixels plus orientation
    // 6; the row has to carry the upright size or every layout is sideways.
    const turned = await sharp(await png(1200, 400))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const source = await openImage(turned);
    expect([source.width, source.height]).toEqual([400, 1200]);
  });

  it("bakes the rotation into the pixels, not just the numbers", async () => {
    const turned = await sharp(await png(1200, 400))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const source = await openImage(turned);
    const pixels = await source.open().png().toBuffer();
    const out = await sharp(pixels).metadata();
    expect([out.width, out.height]).toEqual([400, 1200]);
  });

  it("hands out a fresh pipeline per call, because sharp streams are single-use", async () => {
    const source = await openImage(await png(200, 100));
    const [a, b] = await Promise.all([
      source.open().resize({ width: 50 }).webp().toBuffer(),
      source.open().resize({ width: 20 }).webp().toBuffer(),
    ]);
    expect((await sharp(a).metadata()).width).toBe(50);
    expect((await sharp(b).metadata()).width).toBe(20);
  });

  it("throws on bytes that are no image at all, so the caller can note it", async () => {
    await expect(openImage(new TextEncoder().encode("not a picture"))).rejects.toThrow();
  });
});
