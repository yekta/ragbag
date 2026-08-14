import { chromium } from "playwright";
import { rmSync } from "node:fs";

// Acceptance harness for SETTLE_PLAN.md — "nothing paints until it is the final
// answer". Run it against the local dev stack (`pnpm dev` + `pnpm dev:zero-cache`)
// with an archive of a few hundred items:
//
//   node apps/web/scripts/settle-proof.mjs            # all cases
//   node apps/web/scripts/settle-proof.mjs --keep     # keep the browser profile
//
// It samples the DOM every animation frame, because the defects this plan is
// about are frame-scale: a sync spinner that shows for 570 ms on a device that
// already has every row, a list that collapses to nothing and re-pins itself,
// a card that arrives 16px taller than the one it replaces.
//
// Cumulative layout shift is recorded but is NOT the criterion: the virtualizer
// positions rows with transforms and moves the scroll offset, and CLS counts
// neither. It reported 0.0000 for a frame in which the reader was looking at
// empty space 55 000px from the archive. The anchor invariant below is what
// actually catches that.

const BASE = process.env.RAGBAG_WEB ?? "http://localhost:5173";
const PROFILE = "/tmp/ragbag-settle-proof";
const keep = process.argv.includes("--keep");

/**
 * Installed before any app code runs: labels the screen on every frame.
 *
 * Everything this needs lives inside it — the function is serialised whole and
 * evaluated in the page, so it cannot reference anything from this module.
 */
// oxlint-disable-next-line unicorn/consistent-function-scoping
const SAMPLER = () => {
  const w = window;
  w.settleFrames = [];
  w.settleSockets = 0;
  w.settleCls = 0;

  const OriginalWebSocket = w.WebSocket;
  w.WebSocket = class extends OriginalWebSocket {
    constructor(...args) {
      super(...args);
      // Vite's HMR socket is not Zero's.
      if (String(args[0]).includes("/sync/")) w.settleSockets++;
    }
  };

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) w.settleCls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });

  // Stays inside SAMPLER: this whole function is serialised into the page, so
  // anything it calls has to travel with it.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const label = () => {
    const root = document.getElementById("root");
    if (!root || root.childElementCount === 0) return "blank";
    // The cover is over everything: whatever the shell is doing underneath, the
    // screen is the canvas.
    const cover = document.querySelector("[data-settle-cover='up']");
    if (cover) return cover.querySelector(".animate-spin") ? "loader" : "canvas";
    const text = document.body.innerText || "";
    const cards = document.querySelectorAll("article").length;
    if (text.includes("Continue with Google") || text.includes("Dev sign-in")) return "sign-in";
    if (text.includes("Syncing your archive")) return "syncing";
    if (text.includes("ragbag is empty") || text.includes("Nothing on this device")) return "empty";
    if (cards > 0) return "cards";
    if (document.querySelector("textarea")) return "shell-only";
    if (document.querySelector(".animate-spin")) return "loader";
    return "canvas";
  };

  let last = null;
  const tick = () => {
    const state = label();
    const cards = document.querySelectorAll("article");
    const newest = cards[cards.length - 1]?.getBoundingClientRect();
    const frame = {
      t: Math.round(performance.now()),
      state,
      // Frames behind the cover are not frames the user saw: the archive
      // anchoring itself there is the whole point, not a defect to catch.
      covered: !!document.querySelector("[data-settle-cover='up']"),
      n: cards.length,
      docH: document.documentElement.scrollHeight,
      y: Math.round(scrollY),
      newestTop: newest ? Math.round(newest.top) : null,
      // The sign-in card, for the layout-shift case.
      card: (() => {
        const box = document.querySelector("main [data-slot='card']")?.getBoundingClientRect();
        return box ? `${Math.round(box.height)}@${Math.round(box.top)}` : null;
      })(),
    };
    const key = `${state}|${frame.covered}|${frame.n}|${frame.docH}|${frame.newestTop}|${frame.card}`;
    if (key !== last) {
      w.settleFrames.push(frame);
      last = key;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
};

const read = (page) =>
  page.evaluate(() => ({
    frames: window.settleFrames,
    sockets: window.settleSockets,
    cls: window.settleCls,
  }));
const states = (frames) => {
  const seq = [];
  for (const f of frames) if (seq.at(-1) !== f.state) seq.push(f.state);
  return seq;
};

/** How long a state was on screen, from the frame it appeared to the frame it left. */
const heldFor = (frames, state) => {
  const start = frames.find((f) => f.state === state);
  if (!start) return 0;
  const after = frames.find((f) => f.t > start.t && f.state !== state);
  return (after?.t ?? frames.at(-1).t) - start.t;
};

/**
 * The window the plan is about: from the first frame the archive is *visible*
 * to a second later. Two exclusions, both deliberate. Covered frames don't
 * count — the list laying itself out and anchoring behind the cover is the
 * mechanism working, not a defect (measured: the newest card is 60 000px out of
 * place for ~500ms there, and nobody sees it). And anything after the window is
 * the app reacting to news — an item finishing ingestion drops its "processing"
 * chip and is genuinely a different height — which is not what "nothing flashes
 * on load" means.
 */
const SETTLE_WINDOW_MS = 1_000;
const settleWindow = (frames) => {
  const visible = frames.filter((f) => f.n > 0 && !f.covered);
  return visible.length ? visible.filter((f) => f.t <= visible[0].t + SETTLE_WINDOW_MS) : [];
};

if (!keep) rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1280, height: 900 },
});
await ctx.addInitScript(SAMPLER);
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

// ─── 1. Signed out: one card, one shape ──────────────────────────────────────
// A delayed /api/meta stands in for a remote API; the card may not appear until
// it can be drawn complete, and may not change shape once it has.
await page.route("**/api/meta", async (route) => {
  await new Promise((r) => setTimeout(r, 600));
  await route.continue();
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
const signIn = page.getByRole("button", { name: /dev sign-in|continue with google/i });
// `--keep` reuses a profile that is already signed in, which is how you re-run
// the reload cases against an archive whose ingestion has long since finished.
const signedOut = await signIn.waitFor({ state: "visible", timeout: 20_000 }).then(
  () => true,
  () => false,
);
await page.waitForTimeout(500);
if (signedOut) {
  const { frames } = await read(page);
  const boxes = [...new Set(frames.filter((f) => f.card).map((f) => f.card))];
  check(
    "sign-in card has exactly one shape",
    boxes.length === 1,
    boxes.join(" → ") || "no card seen",
  );
  check(
    "sign-in never shows a half-drawn card",
    !states(frames).includes("shell-only"),
    states(frames).join(" → "),
  );
} else {
  console.log("  ..  sign-in case skipped (profile is already signed in)");
}

await page.unroute("**/api/meta");
if (signedOut) {
  await signIn.click();
  await page.waitForSelector("textarea", { timeout: 20_000 });
  await page.waitForTimeout(3_000);
}

// Seed enough rows that the archive has real geometry.
const seeded = await page.locator("article").count();
if (seeded < 12) {
  const textarea = page.locator("textarea");
  for (let i = seeded; i < 12; i++) {
    await textarea.fill(
      i % 3 === 0
        ? `todo: settle proof item ${i}`
        : `Settle proof item ${i} — a line of archive text that wraps differently per row, so the estimator has something to be wrong about.`,
    );
    await textarea.press("Enter");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2_000);
}

// Ingestion has to have finished before the reload cases mean anything: a card
// whose "queued" chip disappears mid-run is genuinely a different height, and
// that is news arriving rather than the boot flashing. (The anchor invariant
// holds either way — it is the document total that moves.)
const ingested = await page
  .waitForFunction(
    () => !/\b(queued|processing)\b/.test(document.body.innerText || ""),
    undefined,
    {
      timeout: 120_000,
      polling: 1_000,
    },
  )
  .then(
    () => true,
    () => false,
  );
if (!ingested) {
  console.log("  ..  warning: items are still ingesting — height checks may see real edits");
}
await page.waitForTimeout(1_000);

// ─── 2. Warm reloads: canvas → cards, and nothing else ───────────────────────
for (const round of [1, 2, 3, 4, 5]) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  const { frames, sockets, cls } = await read(page);
  const seq = states(frames);
  const withCards = settleWindow(frames);
  const first = withCards[0];
  const last = withCards.at(-1);

  check(
    `warm reload #${round}: canvas → cards, nothing between`,
    ["blank>cards", "blank>canvas>cards"].includes(seq.join(">")),
    seq.join(" → "),
  );
  check(`warm reload #${round}: one Zero client`, sockets <= 1, `${sockets} sync sockets`);
  if (first && last) {
    const moved = Math.abs((first.newestTop ?? 0) - (last.newestTop ?? 0));
    check(`warm reload #${round}: newest card never moves`, moved <= 1, `${moved}px`);
    const heights = withCards.map((f) => f.docH);
    check(
      `warm reload #${round}: document height never shrinks`,
      heights.every((h, i) => i === 0 || h >= heights[i - 1]),
      `${heights[0]} → ${heights.at(-1)}`,
    );
    check(
      `warm reload #${round}: first height within 1% of final`,
      Math.abs(first.docH - last.docH) / last.docH <= 0.01,
      `${first.docH} vs ${last.docH}`,
    );
  }
  if (round === 1) console.log(`        (cls ${cls.toFixed(4)} — recorded, not asserted)`);
}

// ─── 3. First sync on this device: the loader is the first thing, and the only one ──
await page.evaluate(async () => {
  localStorage.removeItem("ragbag:archive");
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs
      .filter((d) => d.name?.startsWith("rep:") || d.name === "replicache-dbs-v0")
      .map(
        (d) =>
          new Promise((res) => {
            const req = indexedDB.deleteDatabase(d.name);
            for (const e of ["success", "error", "blocked"]) req.addEventListener(e, () => res());
          }),
      ),
  );
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 80,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(25_000);
{
  const { frames } = await read(page);
  const seq = states(frames);
  const firstReal = seq.find((s) => s !== "blank" && s !== "canvas");
  check(
    "first sync: the loader is the first thing shown",
    firstReal === "syncing",
    seq.join(" → "),
  );
  check(
    "first sync: cards arrive and the loader never returns",
    seq.lastIndexOf("cards") === seq.length - 1,
    seq.join(" → "),
  );
  const visible = heldFor(frames, "syncing");
  check("first sync: the loader is readable (≥400ms)", visible >= 400, `${visible}ms`);
  // The handover from the sync loader to the finished archive goes behind the
  // cover, so a 400-row list can anchor itself unseen (~500ms of it). That is a
  // cross-fade between two correct states, and it is allowed to take a beat —
  // what it may not do is drag on, or the app looks like it lost the archive it
  // had just told you it was fetching.
  const handover =
    frames.findIndex((f) => f.state === "syncing") >= 0
      ? heldFor(frames.slice(frames.findIndex((f) => f.state === "syncing") + 1), "canvas")
      : 0;
  check(
    "first sync: the loader → archive handover is a beat, not a stall",
    handover <= 600,
    `${handover}ms covered`,
  );
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await ctx.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
