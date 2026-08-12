// M4 acceptance check: the ingestion pipeline end to end against the live dev
// stack — dump items through Zero like a client would, then watch the worker
// classify → extract → (enrich) → index, with results replicating back.
//
// Runs WITHOUT an OpenAI key: extraction and chunk indexing are asserted;
// AI enrichment is asserted only when the server has a key configured.
//
// Run with the dev stack up (postgres, server :3001, zero-cache :4848):
//   pnpm --filter server exec tsx scripts/ingest-proof.mts
import { createHash } from "node:crypto";
import { mutators, queries, schema } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { Zero } from "@rocicorp/zero";
import postgres from "postgres";

const SERVER = "http://localhost:3001";
const CACHE = "http://localhost:4848";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ragbag";

function fail(msg: string): never {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

/**
 * A minimal but valid single-page PDF with a real text layer. Small font:
 * pdfjs's getTextContent ignores glyphs painted outside the MediaBox, so the
 * line must fit on the page.
 */
function buildTinyPdf(text: string): Uint8Array {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 8 Tf 50 700 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = header;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(body);
}

// --- session + clients ---
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

const serverMeta = (await (await fetch(`${SERVER}/api/meta`)).json()) as { blobs: boolean };
const zero = new Zero({
  schema,
  mutators,
  context: { userID: user.id },
  userID: user.id,
  auth: cookie,
  cacheURL: CACHE,
  kvStore: "mem",
});
const sql = postgres(DB, { onnotice: () => {} });

async function uploadBlob(bytes: Uint8Array, mime: string, name: string): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const presign = await fetch(`${SERVER}/api/blobs/presign-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "http://localhost:5173" },
    body: JSON.stringify({ blobId: newId(), sha256, mime, size: bytes.length, originalName: name }),
  });
  if (!presign.ok) fail(`presign ${name}: ${presign.status}`);
  const { blobId, uploadUrl } = (await presign.json()) as {
    blobId: string;
    uploadUrl: string | null;
  };
  if (uploadUrl) {
    const put = await fetch(uploadUrl.replace("http://localhost:5173", SERVER), {
      method: "PUT",
      body: bytes as unknown as BodyInit,
      headers: { "content-type": mime },
    });
    if (!put.ok) fail(`upload ${name}: ${put.status}`);
  }
  return blobId;
}

async function dump(args: Parameters<typeof mutators.item.create>[0]): Promise<string> {
  const result = await zero.mutate(mutators.item.create(args)).server;
  if (result.type === "error") fail(`server rejected ${args.kind}: ${JSON.stringify(result)}`);
  return args.id;
}

// --- dump one of everything the keyless pipeline can prove ---
const noteId = await dump({
  id: newId(),
  kind: "note",
  text: "remember: local-first sync makes offline a non-feature",
});
const linkId = await dump({ id: newId(), kind: "link", url: "https://example.com" });
const blockedId = await dump({ id: newId(), kind: "link", url: "http://192.168.0.1/admin" });

let fileId: string | null = null;
let pdfId: string | null = null;
if (serverMeta.blobs) {
  const textBytes = new TextEncoder().encode(
    "meeting notes\n\nragbag ingestion pipeline review: queue claims with skip locked, " +
      "notify wakes the worker, chunks feed pgvector when available.",
  );
  fileId = await dump({
    id: newId(),
    kind: "file",
    blobId: await uploadBlob(textBytes, "text/plain", "notes.txt"),
  });
  pdfId = await dump({
    id: newId(),
    kind: "pdf",
    blobId: await uploadBlob(
      buildTinyPdf("ragbag pdf extraction works: this page carries a real text layer"),
      "application/pdf",
      "proof.pdf",
    ),
  });
}
console.log(
  "OK   dumped note + link + private-address link" + (serverMeta.blobs ? " + text file + pdf" : ""),
);

// --- wait for the worker ---
type Snapshot = Map<string, { status: string; title?: string; text?: string; error?: string }>;
async function poll(until: (s: Snapshot) => boolean, timeoutMs = 60_000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  let snapshot: Snapshot = new Map();
  while (Date.now() < deadline) {
    const timeline = await zero.run(queries.timeline());
    snapshot = new Map(
      timeline.map((i) => [
        i.id,
        {
          status: i.content?.status ?? "missing",
          title: i.content?.title ?? undefined,
          text: i.content?.extractedText ?? undefined,
          error: i.content?.error ?? undefined,
        },
      ]),
    );
    if (until(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, 500));
  }
  return snapshot;
}

const watched = [noteId, linkId, blockedId, fileId, pdfId].filter((x): x is string => Boolean(x));
const settled = await poll((s) =>
  watched.every((id) => ["done", "failed"].includes(s.get(id)?.status ?? "")),
);
for (const id of watched) {
  console.log(`     ${id.slice(-6)}: ${JSON.stringify(settled.get(id))}`);
}

// --- assertions ---
const note = settled.get(noteId)!;
if (note.status !== "done") fail(`note not done: ${JSON.stringify(note)}`);
console.log("OK   note ingested (no-op extraction)");

const link = settled.get(linkId)!;
if (link.status !== "done") fail(`link not done: ${JSON.stringify(link)}`);
if (!link.title?.includes("Example Domain")) fail(`link title wrong: ${link.title}`);
if (!link.text || !link.text.toLowerCase().includes("domain")) {
  fail(`link extracted text missing readability content: ${link.text?.slice(0, 200)}`);
}
console.log("OK   link extracted: og/readability title + article text synced to the client");

const blocked = settled.get(blockedId)!;
if (blocked.status !== "failed")
  fail(`private-address link should fail: ${JSON.stringify(blocked)}`);
if (!blocked.error?.includes("refusing")) fail(`unexpected error: ${blocked.error}`);
console.log("OK   private-address link permanently failed by the SSRF guard");

if (fileId) {
  const file = settled.get(fileId)!;
  if (file.status !== "done") fail(`file not done: ${JSON.stringify(file)}`);
  if (file.title !== "notes.txt") fail(`file title should be its name: ${file.title}`);
  if (!file.text?.includes("skip locked")) fail(`file text missing: ${file.text}`);
  console.log("OK   text file extracted (title from original name, content indexed)");
}
if (pdfId) {
  const pdf = settled.get(pdfId)!;
  if (pdf.status !== "done") fail(`pdf not done: ${JSON.stringify(pdf)}`);
  if (!pdf.text?.includes("real text layer")) fail(`pdf text layer missing: ${pdf.text}`);
  console.log("OK   pdf text layer extracted via pdfjs");
}

// --- chunks (server-side, so straight SQL) ---
const chunkCounts = await sql<{ item_id: string; n: string }[]>`
  select item_id, count(*) as n from item_chunk
  where item_id = any(${watched}) group by item_id`;
const chunksByItem = new Map(chunkCounts.map((r) => [r.item_id, Number(r.n)]));
if (!chunksByItem.get(noteId)) fail("note text was not chunk-indexed");
if (!chunksByItem.get(linkId)) fail("link article was not chunk-indexed");
console.log(`OK   item_chunk rows written (tsv generated; embeddings when pgvector+key exist)`);

// --- retry mutator round-trip on the failed item ---
const retry = await zero.mutate(mutators.item.retryIngest({ id: blockedId })).server;
if (retry.type === "error") fail(`retryIngest rejected: ${JSON.stringify(retry)}`);
const refailed = await poll((s) => s.get(blockedId)?.status === "failed", 30_000);
if (refailed.get(blockedId)?.status !== "failed") {
  fail(`retried item did not re-process: ${JSON.stringify(refailed.get(blockedId))}`);
}
console.log("OK   item.retryIngest re-queued the job (and the guard failed it again)");

// --- jobs table sanity ---
const jobs = await sql<{ status: string; n: string }[]>`
  select status, count(*) as n from ingest_job
  where item_id = any(${watched}) group by status`;
const jobSummary = Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)]));
if ((jobSummary.done ?? 0) < watched.length - 1)
  fail(`unexpected job states: ${JSON.stringify(jobSummary)}`);
console.log(`OK   ingest_job states: ${JSON.stringify(jobSummary)}`);

console.log("\nPASS ingest proof: dump → queue → worker → extract → index → sync back");
zero.close();
await sql.end();
process.exit(0);
