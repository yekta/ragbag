// heic-decode ships no declarations. It is a thin wrapper over libheif-js
// (WASM): one call in, one decoded frame out. Only the default export is used
// here; `all` exists for multi-image HEIC and we take the primary image.
declare module "heic-decode" {
  const decode: (input: { buffer: Uint8Array }) => Promise<{
    width: number;
    height: number;
    /** RGBA, width * height * 4 bytes, with the container's rotation applied. */
    data: Uint8ClampedArray;
  }>;
  export default decode;
}
