// M1 acceptance check: two Zero clients (think: two browsers) share one
// session; a write on client A must round-trip A → zero-cache → /api/zero/mutate
// → Postgres → logical replication → zero-cache → client B.
//
// Run with the full dev stack up (postgres, server :3001, zero-cache :4848):
//   pnpm --filter server exec tsx scripts/sync-proof.mts
import { mutators, queries, schema } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { Zero } from "@rocicorp/zero";

const SERVER = "http://localhost:3001";
const CACHE = "http://localhost:4848";

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

// 4. Client A dumps a note and a link; both must be accepted by the server.
const noteText = `sync proof note ${Date.now()}`;
const noteWrite = a.mutate(mutators.item.create({ id: newId(), kind: "note", text: noteText }));
const noteResult = await noteWrite.server;
if (noteResult.type === "error") fail(`server rejected note: ${JSON.stringify(noteResult)}`);

const linkUrl = `https://example.com/sync-proof-${Date.now()}`;
const linkWrite = a.mutate(mutators.item.create({ id: newId(), kind: "link", url: linkUrl }));
const linkResult = await linkWrite.server;
if (linkResult.type === "error") fail(`server rejected link: ${JSON.stringify(linkResult)}`);
console.log("OK   client A wrote a note + a link; server pass committed both");

// 5. Client B must see both via sync (poll its local store).
const deadline = Date.now() + 20_000;
let seen: { note: boolean; link: boolean; linkContent: boolean } = {
  note: false,
  link: false,
  linkContent: false,
};
while (Date.now() < deadline) {
  const timeline = await b.run(queries.timeline());
  const note = timeline.find((i) => i.text === noteText);
  const link = timeline.find((i) => i.url === linkUrl);
  seen = {
    note: Boolean(note),
    link: Boolean(link),
    // createItem also wrote the derived item_content row; it syncs through
    // the same pipe. Its status races the live ingest worker (pending →
    // processing → done/failed), so only the row's presence is asserted.
    linkContent: Boolean(link?.content),
  };
  if (seen.note && seen.link && seen.linkContent) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!seen.note || !seen.link) fail(`client B never saw the items: ${JSON.stringify(seen)}`);
if (!seen.linkContent) fail("link's derived item_content row did not sync");
console.log("OK   client B received both items (+ item_content row) via zero-cache");

// 6. Tags: A sets them, B sees them.
const timelineA = await a.run(queries.timeline());
const linkItem = timelineA.find((i) => i.url === linkUrl)!;
const tagsResult = await a.mutate(
  mutators.tag.setForItem({ itemId: linkItem.id, names: ["proof", "sync"] }),
).server;
if (tagsResult.type === "error") fail(`server rejected setForItem: ${JSON.stringify(tagsResult)}`);
const tagDeadline = Date.now() + 20_000;
let tagNames: string[] = [];
while (Date.now() < tagDeadline) {
  const timelineB = await b.run(queries.timeline());
  tagNames = (timelineB.find((i) => i.id === linkItem.id)?.tags ?? [])
    .map((t) => t.name)
    .toSorted();
  if (tagNames.join(",") === "proof,sync") break;
  await new Promise((r) => setTimeout(r, 250));
}
if (tagNames.join(",") !== "proof,sync") fail(`tags did not sync to B: [${tagNames.join(",")}]`);
console.log("OK   user tags set by A synced to B");

console.log("\nPASS end-to-end sync proof: A → zero-cache → /mutate → Postgres → B");
a.close();
b.close();
process.exit(0);
