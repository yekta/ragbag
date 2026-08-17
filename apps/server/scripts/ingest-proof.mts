// Acceptance check for the ingestion pipeline end to end against the live dev
// stack: drop messages through Zero like a client would, then watch the worker
// run phase A (per attachment) and phase B (the whole message), with results
// replicating back.
//
// Runs WITHOUT an OpenAI key: local extraction, the deterministic entity
// pre-pass, status aggregation and the job queue are all asserted either way.
// The model-dependent parts are asserted only when the server has a key.
//
// Run with the dev stack up (postgres, server :3001, zero-cache :4848):
//   pnpm --filter server exec tsx scripts/ingest-proof.mts
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { mutators, queries, schema } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { Zero } from "@rocicorp/zero";
import postgres from "postgres";

const SERVER = "http://localhost:3001";
const CACHE = "http://localhost:4848";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ragbag";
const WHOLE_ARCHIVE = { limit: null };

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

// 5x7 bitmap glyphs for the word rendered into the test image.
const FONT: Record<string, string[]> = {
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  G: [".###.", "#...#", "#....", "#..##", "#...#", "#...#", ".###."],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
};
const OCR_WORD = "RAGBAG";

/** Levenshtein distance: the OCR assertion allows a little model slop. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** One length-prefixed, CRC-suffixed PNG chunk. */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0;
  out.writeUInt32BE(crc, data.length + 8);
  return out;
}

/**
 * A real greyscale PNG (encoded here so the repo carries no binary fixture):
 * big black block letters on white, which the vision model must both describe
 * and transcribe, and which sharp must be able to transcode and thumbnail.
 */
function buildTestPng(word: string, scale = 14): Uint8Array {
  const glyphW = 5;
  const glyphH = 7;
  const gap = 1;
  const pad = 3;
  const width = (word.length * (glyphW + gap) - gap + pad * 2) * scale;
  const height = (glyphH + pad * 2) * scale;

  const px = new Uint8Array(width * height).fill(0xff); // white background
  [...word].forEach((ch, i) => {
    const glyph = FONT[ch];
    if (!glyph) fail(`no glyph for ${ch}`);
    const originX = (pad + i * (glyphW + gap)) * scale;
    const originY = pad * scale;
    for (let gy = 0; gy < glyphH; gy++) {
      for (let gx = 0; gx < glyphW; gx++) {
        if (glyph[gy]![gx] !== "#") continue;
        for (let dy = 0; dy < scale; dy++) {
          const rowStart = (originY + gy * scale + dy) * width + originX + gx * scale;
          px.fill(0x00, rowStart, rowStart + scale); // black ink
        }
      }
    }
  });

  // Scanlines with filter byte 0, then the usual IHDR/IDAT/IEND chunks.
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    Buffer.from(px.subarray(y * width, (y + 1) * width)).copy(raw, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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

const serverMeta = (await (await fetch(`${SERVER}/api/meta`)).json()) as {
  blobs: boolean;
  ai: boolean;
};
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

type Attach = { id: string; blobId: string; filename: string; mime: string; size: number };

async function uploadBlob(bytes: Uint8Array, mime: string, name: string): Promise<Attach> {
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
  return { id: newId(), blobId, filename: name, mime, size: bytes.length };
}

async function drop(text: string | undefined, attachments: Attach[] = []): Promise<string> {
  const id = newId();
  const result = await zero.mutate(mutators.message.create({ id, text, attachments })).server;
  if (result.type === "error") fail(`server rejected a message: ${JSON.stringify(result)}`);
  return id;
}

// --- one of everything the pipeline has to handle ---

// A message that is only the owner's words, carrying three things with strong
// syntactic signatures. These must be found with or without an OpenAI key.
const TRACKING = "1Z999AA10123456784";
const LINK = "https://example.com";
const EMAIL = "ada.lovelace@example.com";
const textOnlyId = await drop(
  `parcel ${TRACKING} arriving thursday, details at ${LINK}, ask ${EMAIL} if it is late`,
);

// The same link again, in a different message: one canonical entity, two
// mentions. That split is the whole reason entities and mentions are separate
// tables (plan §2.3).
const secondLinkId = await drop(`re-reading ${LINK} tonight`);

// A link that the SSRF guard must refuse to fetch. It is still a link entity;
// only its enrichment fails, and the message still finishes.
const blockedId = await drop("internal dashboard at http://192.168.0.1/admin");

let albumId: string | null = null;
let corruptId: string | null = null;
let unuploadedId: string | null = null;
let imageAttachmentId: string | null = null;
let pdfAttachmentId: string | null = null;
let fileAttachmentId: string | null = null;

if (serverMeta.blobs) {
  const textFile = await uploadBlob(
    new TextEncoder().encode(
      "meeting notes\n\nragbag ingestion review: the queue claims with skip locked, " +
        "notify wakes the worker, and synthesis waits on its own parts.",
    ),
    "text/plain",
    "notes.txt",
  );
  const pdf = await uploadBlob(
    buildTinyPdf("ragbag pdf extraction works: this page carries a real text layer"),
    "application/pdf",
    "proof.pdf",
  );
  const image = await uploadBlob(buildTestPng(OCR_WORD), "image/png", "sign.png");
  fileAttachmentId = textFile.id;
  pdfAttachmentId = pdf.id;
  imageAttachmentId = image.id;

  // One send, three files, in this order: `position` is what makes the chat
  // render them "exactly as it was sent".
  albumId = await drop("everything in one message", [textFile, pdf, image]);

  // Bytes that are not an image at all: the vision API rejects these with a
  // 4xx, which must fail that ATTACHMENT immediately (no retries) and leave
  // the message `partial` rather than `failed`.
  const corrupt = await uploadBlob(
    new TextEncoder().encode("this is definitely not a png"),
    "image/png",
    "corrupt.png",
  );
  corruptId = await drop("a broken picture", [corrupt]);

  // Offline capture: the message syncs with a client-minted blobId BEFORE the
  // upload queue has presigned anything, so no blob row (and no bytes) exist
  // yet. The worker must park the job, not fail or crash on it.
  unuploadedId = await drop("still uploading", [
    { id: newId(), blobId: newId(), filename: "later.png", mime: "image/png", size: 1 },
  ]);
}
console.log(
  "OK   dropped a text-only message, a repeated link, a blocked link" +
    (serverMeta.blobs ? ", a three-file album, a corrupt image and an un-uploaded one" : ""),
);

// --- wait for the worker ---
type Row = {
  status: string;
  title?: string;
  summary?: string;
  error?: string;
  attachments: { id: string; filename: string; status: string; error?: string }[];
  entities: { kind: string; value: string; attachmentId: string | null }[];
};
type Snapshot = Map<string, Row>;

async function poll(until: (s: Snapshot) => boolean, timeoutMs = 90_000): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  let snapshot: Snapshot = new Map();
  while (Date.now() < deadline) {
    const rows = await zero.run(queries.drop(WHOLE_ARCHIVE));
    snapshot = new Map(
      rows.map((m) => [
        m.id,
        {
          status: m.status,
          title: m.generatedTitle ?? undefined,
          summary: m.generatedSummary ?? undefined,
          error: m.error ?? undefined,
          attachments: m.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            status: a.status,
            error: a.error ?? undefined,
          })),
          entities: m.mentions.map((mention) => ({
            kind: mention.entity?.kind ?? "?",
            value: mention.entity?.value ?? "?",
            attachmentId: mention.attachmentId ?? null,
          })),
        },
      ]),
    );
    if (until(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, 500));
  }
  return snapshot;
}

// The un-uploaded message never settles by design; it is asserted separately.
const watched = [textOnlyId, secondLinkId, blockedId, albumId, corruptId].filter((x): x is string =>
  Boolean(x),
);
const TERMINAL = ["done", "partial", "failed"];
const settled = await poll((s) =>
  watched.every((id) => TERMINAL.includes(s.get(id)?.status ?? "")),
);
for (const id of watched) {
  console.log(`     ${id.slice(-6)}: ${JSON.stringify(settled.get(id))}`);
}

// --- assertions ---

// 1. The deterministic pre-pass: three kinds with strong signatures, found
// with no AI at all, each mentioned from the message's own text.
const textOnly = settled.get(textOnlyId)!;
if (!TERMINAL.includes(textOnly.status)) fail(`text message never settled: ${textOnly.status}`);
for (const kind of ["tracking", "link", "email"]) {
  if (!textOnly.entities.some((e) => e.kind === kind)) {
    fail(`the pre-pass missed a ${kind}: ${JSON.stringify(textOnly.entities)}`);
  }
}
if (textOnly.entities.some((e) => e.attachmentId !== null)) {
  fail("a mention from the message text claimed to come from an attachment");
}
console.log("OK   link + email + tracking found by the deterministic pre-pass (no AI needed)");

// 2. One entity, two mentions: the split that makes "seen in 2 messages"
// possible and stops the rail growing a duplicate row.
const [linkEntity] = await sql<{ id: string; kind: string; normalized_value: string }[]>`
  select id, kind, normalized_value from entities
  where user_id = ${user.id} and kind = 'link' and normalized_value = ${LINK}`;
if (!linkEntity) fail(`no canonical link entity for ${LINK}`);
const [mentionCount] = await sql<{ n: string }[]>`
  select count(*) as n from message_entities where entity_id = ${linkEntity.id}`;
if (Number(mentionCount?.n ?? 0) !== 2) {
  fail(`the same link in two messages produced ${mentionCount?.n} mentions, want 2`);
}
console.log("OK   the same link in two messages is one entity with two mentions");

// 3. The SSRF guard: the link is still an entity, its enrichment is what
// failed, and the message finished rather than dying with it.
const blocked = settled.get(blockedId)!;
if (blocked.status === "failed") fail(`a link that could not be fetched failed the message`);
if (!blocked.entities.some((e) => e.kind === "link")) fail("the blocked link produced no entity");
console.log("OK   an unfetchable link still becomes an entity; the message still finishes");

if (albumId) {
  // 4. Phase A ran per attachment, in send order, and each wrote content_md.
  const album = settled.get(albumId)!;
  if (album.attachments.map((a) => a.filename).join(",") !== "notes.txt,proof.pdf,sign.png") {
    fail(`attachments came back out of order: ${JSON.stringify(album.attachments)}`);
  }
  const contents = await sql<{ attachment_id: string; content_md: string }[]>`
    select attachment_id, content_md from attachment_contents
    where attachment_id = any(${[fileAttachmentId, pdfAttachmentId].filter(Boolean) as string[]})`;
  const byId = new Map(contents.map((c) => [c.attachment_id, c.content_md]));
  if (!byId.get(fileAttachmentId!)?.includes("skip locked")) {
    fail(`the text file's content_md is missing its own bytes`);
  }
  if (!byId.get(fileAttachmentId!)?.startsWith("```")) {
    fail("a textual file's content_md must be fenced (plan §5.3)");
  }
  if (!byId.get(pdfAttachmentId!)?.includes("real text layer")) {
    fail("the PDF's text layer did not reach content_md");
  }
  if (!byId.get(pdfAttachmentId!)?.includes("## Page 1")) {
    fail("the PDF's content_md is missing its page markers (plan §5.3)");
  }
  console.log("OK   every attachment extracted on its own, in one content_md shape");

  // 5. Derivatives: true dimensions, both variants, and a placeholder that
  // makes cache eviction invisible.
  const [imageRow] = await sql<
    {
      width: number | null;
      height: number | null;
      variants: { display?: boolean; thumb?: boolean };
      placeholder: string | null;
      status: string;
    }[]
  >`
    select width, height, variants, placeholder, status from attachments
    where id = ${imageAttachmentId!}`;
  if (imageRow?.status !== "done") fail(`the image attachment is ${imageRow?.status}`);
  if (!imageRow.width || !imageRow.height) fail("the derivatives pass recorded no dimensions");
  if (!imageRow.variants?.display || !imageRow.variants?.thumb) {
    fail(`derivatives missing: ${JSON.stringify(imageRow.variants)}`);
  }
  if (!imageRow.placeholder) fail("no placeholder was computed for the image");
  console.log(
    `OK   image derivatives written (${imageRow.width}x${imageRow.height}, ` +
      `${Object.keys(imageRow.variants).join("+")}, ${imageRow.placeholder.length}-char placeholder)`,
  );

  // The media URL serves them, which is the only thing that ever goes in a src.
  const [blobRow] = await sql<{ blob_id: string }[]>`
    select blob_id from attachments where id = ${imageAttachmentId!}`;
  for (const variant of ["thumb", "display", "original"]) {
    const res = await fetch(`${SERVER}/api/media/${blobRow!.blob_id}/${variant}`, {
      headers: { cookie },
      redirect: "manual",
    });
    if (res.status !== 302) fail(`/api/media/.../${variant}: ${res.status}, want 302`);
  }
  console.log("OK   /api/media serves thumb, display and original for the same blob id");
}

if (corruptId) {
  // 6. A part that cannot be read fails alone: the message is `partial`, not
  // `failed`, and the 4xx is not retried.
  const corrupt = settled.get(corruptId)!;
  const part = corrupt.attachments[0];
  if (!serverMeta.ai) {
    console.log("SKIP corrupt-image handling (server has no OpenAI key)");
  } else {
    if (part?.status !== "failed") fail(`corrupt image should fail: ${JSON.stringify(part)}`);
    if (corrupt.status !== "partial") {
      fail(`one failed part should leave the message partial, got ${corrupt.status}`);
    }
    const [job] = await sql<{ attempts: number }[]>`
      select attempts from ingest_jobs where attachment_id = ${part.id}`;
    if (job?.attempts !== 1) {
      fail(`corrupt image burned ${job?.attempts} attempts; a 4xx must not be retried`);
    }
    console.log("OK   a failed part fails alone: message `partial`, no wasted retries");
  }
}

if (unuploadedId) {
  // 7. The offline-capture path: parked, not failed, not counted as an
  // attempt, and above all it must not crash the worker.
  const [job] = await sql<{ status: string; attempts: number; last_error: string | null }[]>`
    select j.status, j.attempts, j.last_error from ingest_jobs j
    where j.message_id = ${unuploadedId} and j.stage = 'attachment'`;
  if (!job) fail("no attachment job for the un-uploaded message");
  if (job.status !== "queued") {
    fail(`a message awaiting its upload should stay queued, got ${JSON.stringify(job)}`);
  }
  if (job.attempts !== 0) fail(`waiting must not burn attempts, got ${job.attempts}`);
  if (!job.last_error?.includes("waiting for the file upload")) {
    fail(`unexpected wait reason: ${job.last_error}`);
  }
  // Synthesis must be waiting on it rather than racing ahead of it.
  const [synthesis] = await sql<{ status: string; last_error: string | null }[]>`
    select status, last_error from ingest_jobs
    where message_id = ${unuploadedId} and stage = 'synthesis'`;
  if (synthesis?.status !== "queued" || !synthesis.last_error?.includes("waiting for")) {
    fail(`synthesis did not wait for its parts: ${JSON.stringify(synthesis)}`);
  }
  const health = await fetch(`${SERVER}/health`).catch(() => null);
  if (!health?.ok) fail("the API server died while handling a waiting job");
  console.log("OK   an un-uploaded part parks, synthesis waits for it, and the API is alive");
}

// 8. The model-dependent half. Asserted only where the server can deliver it;
// a metered usage row is what proves the key works and the call actually ran.
const [enrichMetered] = await sql<{ n: string }[]>`
  select count(*) as n from ai_usage_events
  where user_id = ${user.id} and kind = 'enrich'`;
if (Number(enrichMetered?.n ?? 0) === 0) {
  console.log("SKIP synthesis assertions (server has no OpenAI key)");
} else {
  const enriched = settled.get(textOnlyId)!;
  if (!enriched.title || !enriched.summary) {
    fail(`synthesis produced no title/summary: ${JSON.stringify(enriched)}`);
  }
  const [tagCount] = await sql<{ n: string }[]>`
    select count(*) as n from message_tags
    where message_id = ${textOnlyId} and source = 'ai'`;
  if (Number(tagCount?.n ?? 0) === 0) fail("synthesis wrote no AI tags");
  console.log(
    `OK   synthesis titled, summarized and tagged (title: ${JSON.stringify(enriched.title)})`,
  );

  // The tracking number should have come back with its carrier: that is the
  // model's half of hybrid extraction, adding structure the regex cannot know.
  const [tracked] = await sql<{ data: { carrier?: string } }[]>`
    select data from entities where user_id = ${user.id} and kind = 'tracking'`;
  console.log(
    `     tracking entity data: ${JSON.stringify(tracked?.data ?? null)} (advisory: the carrier is the model's judgment)`,
  );

  if (imageAttachmentId) {
    const [image] = await sql<{ generated_title: string | null; content_md: string | null }[]>`
      select a.generated_title, c.content_md from attachments a
      left join attachment_contents c on c.attachment_id = a.id
      where a.id = ${imageAttachmentId}`;
    if (!image?.generated_title || image.generated_title === "sign.png") {
      fail(`vision did not title the image (still ${JSON.stringify(image?.generated_title)})`);
    }
    if (!image.content_md?.includes("## What this shows")) {
      fail(`the image's content_md is not in the documented shape: ${image.content_md}`);
    }
    // What we own is the round-trip, not the model's eyesight: a 5x7 bitmap
    // font has come back as "RASBEG" and "RAGERS" across runs, so drift is
    // logged for a human rather than pinned to a threshold.
    const ocr = /## Text in the image\n\n([\s\S]*)$/.exec(image.content_md)?.[1]?.trim() ?? "";
    const drift = editDistance(ocr.replace(/\s/g, "").toUpperCase(), OCR_WORD);
    console.log(
      `OK   vision described + OCR'd the image (read ${JSON.stringify(ocr)} vs "${OCR_WORD}": ` +
        `${drift} char(s) of model drift)`,
    );
  }
}

// 9. The tombstone: dismiss a mention, re-run ingestion, and it stays gone.
// This is what makes re-ingestion safe to offer at all (plan §2.3).
const dismissTarget = await sql<{ entity_id: string; attachment_id: string | null }[]>`
  select entity_id, attachment_id from message_entities
  where message_id = ${textOnlyId} limit 1`;
if (dismissTarget[0]) {
  const dismissed = await zero.mutate(
    mutators.entity.dismiss({
      messageId: textOnlyId,
      entityId: dismissTarget[0].entity_id,
      attachmentId: dismissTarget[0].attachment_id,
    }),
  ).server;
  if (dismissed.type === "error") fail(`entity.dismiss rejected: ${JSON.stringify(dismissed)}`);

  const retry = await zero.mutate(mutators.message.retryIngest({ id: textOnlyId })).server;
  if (retry.type === "error") fail(`retryIngest rejected: ${JSON.stringify(retry)}`);
  await poll((s) => TERMINAL.includes(s.get(textOnlyId)?.status ?? ""), 60_000);

  const [stillDismissed] = await sql<{ n: string }[]>`
    select count(*) as n from message_entities
    where message_id = ${textOnlyId} and entity_id = ${dismissTarget[0].entity_id}
      and dismissed_at is not null`;
  if (Number(stillDismissed?.n ?? 0) !== 1) {
    fail("a dismissed mention came back after re-ingestion");
  }
  const [duplicates] = await sql<{ n: string }[]>`
    select count(*) as n from message_entities
    where message_id = ${textOnlyId} and entity_id = ${dismissTarget[0].entity_id}`;
  if (Number(duplicates?.n ?? 0) !== 1) {
    fail(`re-ingestion accumulated ${duplicates?.n} rows for one mention instead of converging`);
  }
  console.log("OK   re-ingestion converges, and a dismissed mention stays dismissed");
}

// 10. Job states, per stage: every message has exactly one synthesis job and
// one job per attachment, and nothing is stranded.
const jobs = await sql<{ stage: string; status: string; n: string }[]>`
  select stage, status, count(*) as n from ingest_jobs
  where message_id = any(${watched}) group by stage, status`;
const summary = Object.fromEntries(jobs.map((j) => [`${j.stage}:${j.status}`, Number(j.n)]));
if ((summary["synthesis:done"] ?? 0) !== watched.length) {
  fail(`not every message got through synthesis: ${JSON.stringify(summary)}`);
}
if ((summary["attachment:running"] ?? 0) > 0 || (summary["synthesis:running"] ?? 0) > 0) {
  fail(`jobs left stranded in 'running': ${JSON.stringify(summary)}`);
}
console.log(`OK   ingest_jobs per stage: ${JSON.stringify(summary)}`);

console.log("\nPASS ingest proof: drop → fan-out → phase A → phase B → entities → sync back");
zero.close();
await sql.end();
process.exit(0);
