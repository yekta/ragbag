// Acceptance check for the sync spine: two Zero clients (think: two browsers)
// share one session; a write on client A must round-trip A → zero-cache →
// /api/zero/mutate → Postgres → logical replication → zero-cache → client B.
//
// Run with the full dev stack up (postgres, server :3001, zero-cache :4848):
//   pnpm --filter server exec tsx scripts/sync-proof.mts
import { mutators, queries, schema } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { Zero } from "@rocicorp/zero";

const SERVER = "http://localhost:3001";
const CACHE = "http://localhost:4848";

/** The whole archive: what every client preloads today (plan §14.1). */
const WHOLE_ARCHIVE = { limit: null };

function fail(msg: string): never {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

// 1. Unauthenticated requests must be rejected.
const unauthed = await fetch(`${SERVER}/api/zero/query`, { method: "POST", body: "[]" });
if (unauthed.status !== 401) fail(`/api/zero/query without session: ${unauthed.status}, want 401`);
console.log("OK   /api/zero/query rejects unauthenticated requests (401)");

// 2. Dev sign-in (anonymous plugin) → session cookie, like a browser would.
const signIn = await fetch(`${SERVER}/api/auth/sign-in/anonymous`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost:5173" },
  body: "{}",
});
if (!signIn.ok) fail(`anonymous sign-in: ${signIn.status} ${await signIn.text()}`);
const { user } = (await signIn.json()) as { user: { id: string } };
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
if (!cookie) fail("no session cookie returned");
console.log(`OK   anonymous session for user ${user.id}`);

// 3. Two clients, same user. Native shells pass the session cookie as the Zero
// auth token; the server's Bearer→Cookie shim turns it back into a session.
const makeClient = () =>
  new Zero({
    schema,
    mutators,
    context: { userID: user.id },
    userID: user.id,
    auth: cookie,
    cacheURL: CACHE,
    kvStore: "mem",
  });
const a = makeClient();
const b = makeClient();

// 4. Client A drops a text-only message and one with two attachments. Both
// must be accepted by the server pass, attachments and all.
const noteText = `sync proof note ${Date.now()}`;
const noteResult = await a.mutate(mutators.message.create({ id: newId(), text: noteText })).server;
if (noteResult.type === "error") fail(`server rejected the note: ${JSON.stringify(noteResult)}`);

const albumId = newId();
const albumText = `sync proof album ${Date.now()}`;
const files = [
  { id: newId(), blobId: newId(), filename: "one.png", mime: "image/png", size: 11 },
  { id: newId(), blobId: newId(), filename: "two.pdf", mime: "application/pdf", size: 22 },
];
const albumResult = await a.mutate(
  mutators.message.create({ id: albumId, text: albumText, attachments: files }),
).server;
if (albumResult.type === "error") fail(`server rejected the album: ${JSON.stringify(albumResult)}`);
console.log("OK   client A dropped a note + a two-attachment message; both committed");

// 5. Client B must see both via sync, with the attachments in the order they
// were sent: `position` is what "exactly as it was sent" means (plan §2.2).
const deadline = Date.now() + 20_000;
let seen = { note: false, album: false, order: "" };
while (Date.now() < deadline) {
  const drop = await b.run(queries.drop(WHOLE_ARCHIVE));
  const album = drop.find((m) => m.id === albumId);
  seen = {
    note: drop.some((m) => m.text === noteText),
    album: Boolean(album),
    order: (album?.attachments ?? []).map((f) => f.filename).join(","),
  };
  if (seen.note && seen.order === "one.png,two.pdf") break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!seen.note || !seen.album) fail(`client B never saw the messages: ${JSON.stringify(seen)}`);
if (seen.order !== "one.png,two.pdf") fail(`attachments arrived out of order: [${seen.order}]`);
console.log("OK   client B received both messages, attachments in send order");

// 6. Tags: A sets them, B sees them.
const tagsResult = await a.mutate(
  mutators.tag.setForMessage({ messageId: albumId, names: ["proof", "sync"] }),
).server;
if (tagsResult.type === "error")
  fail(`server rejected setForMessage: ${JSON.stringify(tagsResult)}`);
const tagDeadline = Date.now() + 20_000;
let tagNames: string[] = [];
while (Date.now() < tagDeadline) {
  const drop = await b.run(queries.drop(WHOLE_ARCHIVE));
  tagNames = (drop.find((m) => m.id === albumId)?.tags ?? [])
    .map((t) => t.tag?.name ?? "")
    .filter(Boolean)
    .toSorted();
  if (tagNames.join(",") === "proof,sync") break;
  await new Promise((r) => setTimeout(r, 250));
}
if (tagNames.join(",") !== "proof,sync") fail(`tags did not sync to B: [${tagNames.join(",")}]`);
console.log("OK   user tags set by A synced to B");

// 7. Soft delete drops it from the archive on the other device too.
const deleteResult = await a.mutate(mutators.message.delete({ id: albumId })).server;
if (deleteResult.type === "error") fail(`server rejected delete: ${JSON.stringify(deleteResult)}`);
const deleteDeadline = Date.now() + 20_000;
let stillThere = true;
while (Date.now() < deleteDeadline) {
  const drop = await b.run(queries.drop(WHOLE_ARCHIVE));
  stillThere = drop.some((m) => m.id === albumId);
  if (!stillThere) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (stillThere) fail("a deleted message stayed in client B's archive");
console.log("OK   soft delete removed it from client B's archive");

console.log("\nPASS end-to-end sync proof: A → zero-cache → /mutate → Postgres → B");
a.close();
b.close();
process.exit(0);
