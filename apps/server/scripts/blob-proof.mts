// Acceptance check for the blob path: presigned upload → content-addressed
// dedupe → presigned download → the stable media URL, exactly the sequence the
// web composer, the client-runtime BlobQueue and the media service worker
// perform. Works against either storage driver (local disk in dev, R2 when
// configured).
//
// Run with the dev stack up (postgres, server :3001):
//   pnpm --filter server exec tsx scripts/blob-proof.mts
import { createHash, randomBytes } from "node:crypto";
import { mutators, queries, schema } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { Zero } from "@rocicorp/zero";

const SERVER = "http://localhost:3001";
const CACHE = "http://localhost:4848";

function fail(msg: string): never {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

// 1. Unauthenticated presigns must be rejected.
const unauthed = await fetch(`${SERVER}/api/blobs/presign-upload`, { method: "POST", body: "{}" });
if (unauthed.status !== 401) fail(`presign without session: ${unauthed.status}, want 401`);
console.log("OK   presign-upload rejects unauthenticated requests (401)");

// 2. Session, like a browser.
const signIn = await fetch(`${SERVER}/api/auth/sign-in/anonymous`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost:5173" },
  body: "{}",
});
if (!signIn.ok) fail(`anonymous sign-in: ${signIn.status}`);
const { user } = (await signIn.json()) as { user: { id: string } };
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
console.log(`OK   anonymous session for user ${user.id}`);

const bytes = randomBytes(64 * 1024);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const mime = "image/png";

async function presign(blobId: string) {
  const res = await fetch(`${SERVER}/api/blobs/presign-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "http://localhost:5173" },
    body: JSON.stringify({ blobId, sha256, mime, size: bytes.length, originalName: "proof.png" }),
  });
  if (!res.ok) fail(`presign-upload: ${res.status} ${await res.text()}`);
  return (await res.json()) as { blobId: string; uploadUrl: string | null };
}

// 3. First presign must hand out an upload URL bound to the client's blobId.
const clientBlobId = newId();
const first = await presign(clientBlobId);
if (first.blobId !== clientBlobId) fail(`server ignored client blobId: ${first.blobId}`);
if (!first.uploadUrl) fail("first presign returned no uploadUrl");
console.log("OK   presign accepted the client-minted blobId and returned an upload URL");

// 3b. Re-presign before the bytes were uploaded (an interrupted upload
// retrying) must return an uploadUrl again, not swallow the bytes.
const retry = await presign(clientBlobId);
if (!retry.uploadUrl) fail("retry presign returned no uploadUrl despite missing bytes");
console.log("OK   presign retries until the bytes actually exist in the store");

// 4. PUT the bytes to the presigned URL EXACTLY as handed out (no session:
// the URL itself is the bearer). Never rewrite it: the whole point is to
// exercise the URL a browser would use, whichever driver produced it.
const put = await fetch(retry.uploadUrl, {
  method: "PUT",
  body: bytes,
  headers: { "content-type": mime },
});
if (!put.ok) fail(`upload PUT: ${put.status} ${await put.text()}`);
console.log("OK   bytes uploaded through the presigned URL");

// 5. Same content, a second client id: the caller keeps ITS id (a client that
// minted the id offline already has items pointing at it), and the bytes are
// not re-uploaded because the content-addressed object already exists.
const otherBlobId = newId();
const second = await presign(otherBlobId);
if (second.blobId !== otherBlobId) {
  fail(`presign reassigned the client's blobId to ${second.blobId}: items would orphan`);
}
if (second.uploadUrl !== null) fail("identical bytes should not need a second upload");
console.log("OK   re-dump keeps the caller's blobId and skips the upload (one object, two rows)");

// 5b. Both ids must resolve to the same bytes: that is what makes reusing the
// object safe.
for (const id of [clientBlobId, otherBlobId]) {
  const res = await fetch(`${SERVER}/api/blobs/${id}/download-url`, {
    headers: { cookie, origin: "http://localhost:5173" },
  });
  if (!res.ok) fail(`download-url for ${id}: ${res.status}`);
  const { url: each } = (await res.json()) as { url: string };
  const bytesBack = Buffer.from(await (await fetch(each)).arrayBuffer());
  if (!bytesBack.equals(bytes)) fail(`blob ${id} resolved to different bytes`);
}
console.log("OK   both blob ids resolve to the same stored object");

// 6. Download roundtrip.
const dl = await fetch(`${SERVER}/api/blobs/${clientBlobId}/download-url`, {
  headers: { cookie, origin: "http://localhost:5173" },
});
if (!dl.ok) fail(`download-url: ${dl.status}`);
const { url } = (await dl.json()) as { url: string };
const got = await fetch(url);
if (!got.ok) fail(`download GET: ${got.status}`);
const roundtrip = Buffer.from(await got.arrayBuffer());
if (!roundtrip.equals(bytes)) fail("downloaded bytes differ from uploaded bytes");
if (got.headers.get("content-type") !== mime) {
  fail(`download content-type ${got.headers.get("content-type")}, want ${mime}`);
}
console.log("OK   download-url roundtrips the exact bytes with the right content type");

// 7. A tampered signature must be rejected.
const tampered = await fetch(`${url}x`);
if (tampered.ok) fail("tampered download URL was accepted");
console.log("OK   tampered presigned URLs are rejected");

// 8. The batch presign the media worker uses: up to ~100 ids in one request,
// a map back, and nothing for ids this user does not own.
const batch = await fetch(`${SERVER}/api/blobs/download-urls`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin: "http://localhost:5173" },
  body: JSON.stringify({ blobIds: [clientBlobId, otherBlobId, newId()], variant: "original" }),
});
if (!batch.ok) fail(`download-urls: ${batch.status} ${await batch.text()}`);
const { urls } = (await batch.json()) as { urls: Record<string, string> };
if (!urls[clientBlobId] || !urls[otherBlobId]) fail("batch presign missed an owned blob");
if (Object.keys(urls).length !== 2) fail("batch presign leaked a blob the caller does not own");
console.log("OK   batch presign answers many ids at once and only for their owner");

// 9. The media URL: one stable string per picture, which is the only thing
// that ever goes in a `src`. It must 302 to a presigned GET, and refuse
// without a session. `redirect: manual` so the redirect itself is the subject.
const anonMedia = await fetch(`${SERVER}/api/media/${clientBlobId}/original`, {
  redirect: "manual",
});
if (anonMedia.status !== 401) fail(`/api/media without session: ${anonMedia.status}, want 401`);

const media = await fetch(`${SERVER}/api/media/${clientBlobId}/original`, {
  headers: { cookie, origin: "http://localhost:5173" },
  redirect: "manual",
});
if (media.status !== 302) fail(`/api/media: ${media.status}, want a 302 to a presigned GET`);
const target = media.headers.get("location");
if (!target) fail("/api/media redirected to nothing");
const mediaBytes = Buffer.from(await (await fetch(target)).arrayBuffer());
if (!mediaBytes.equals(bytes)) fail("the media URL resolved to different bytes");
console.log("OK   /api/media/<id>/<variant> 302s to the bytes, and 401s without a session");

// 9b. A variant that has not been generated yet falls back to the original
// rather than 404ing: a photo is browsed before ingestion has finished it.
const thumb = await fetch(`${SERVER}/api/media/${clientBlobId}/thumb`, {
  headers: { cookie, origin: "http://localhost:5173" },
  redirect: "manual",
});
if (thumb.status !== 302) fail(`/api/media thumb: ${thumb.status}, want 302`);
console.log("OK   a missing derivative falls back to the original instead of 404ing");

// 10. A message whose attachment points at the blob syncs like any other.
const zero = new Zero({
  schema,
  mutators,
  context: { userID: user.id },
  userID: user.id,
  auth: cookie,
  cacheURL: CACHE,
  kvStore: "mem",
});
const messageId = newId();
const attachmentId = newId();
const write = zero.mutate(
  mutators.message.create({
    id: messageId,
    text: "blob proof",
    attachments: [
      {
        id: attachmentId,
        blobId: clientBlobId,
        filename: "proof.png",
        mime,
        size: bytes.length,
      },
    ],
  }),
);
const result = await write.server;
if (result.type === "error") fail(`server rejected the message: ${JSON.stringify(result)}`);
const deadline = Date.now() + 20_000;
let synced = false;
while (Date.now() < deadline && !synced) {
  const drop = await zero.run(queries.drop({ limit: null }));
  synced = drop.some(
    (m) => m.id === messageId && m.attachments.some((a) => a.blobId === clientBlobId),
  );
  if (!synced) await new Promise((r) => setTimeout(r, 250));
}
if (!synced) fail("the message's attachment did not sync back");
console.log("OK   a message whose attachment references the blob synced end to end");

console.log("\nPASS blob proof: presign → upload → dedupe → download → batch → media URL → sync");
zero.close();
process.exit(0);
