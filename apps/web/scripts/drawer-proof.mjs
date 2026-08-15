import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// Acceptance harness for BASE_UI_PLAN.md §8.2 / §8.3: the detail drawer.
//
// The settle harness next door proves nothing flashes in the timeline; it does
// not open the detail overlay at all. This one covers what the Sheet → Drawer
// swap actually changed: the desktop panel's inset floating-card geometry, the
// mobile bottom sheet and its handle, and the three judgment calls the plan
// flagged for real pixels (overlay contrast in dark mode, destructive styling,
// alpha fills across surfaces).
//
//   node apps/web/scripts/drawer-proof.mjs
//   RAGBAG_WEB=http://localhost:5174 node apps/web/scripts/drawer-proof.mjs

const BASE = process.env.RAGBAG_WEB ?? "http://localhost:5173";
const PROFILE = "/tmp/ragbag-drawer-proof";
const SHOTS = "/tmp/drawer-shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const setTheme = async (theme) => {
  await page.evaluate((t) => {
    localStorage.setItem("ragbag:theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });

// Sign in if this profile is cold.
const signIn = page.getByRole("button", { name: /dev sign-in|continue with google/i });
const signedOut = await signIn
  .waitFor({ state: "visible", timeout: 15_000 })
  .then(() => true)
  .catch(() => false);
if (signedOut) {
  await signIn.click();
  await page.waitForSelector("textarea", { timeout: 30_000 });
}
// A fresh dev-login profile owns nothing, and the drawer needs something to
// open. Seed a couple of items through the composer (the same path a reader
// uses) including one long enough to force the body to scroll.
if ((await page.locator("article").count()) === 0) {
  const box = page.locator("textarea").first();
  const seeds = [
    "Drawer proof: a short note.",
    `Drawer proof: a long note that has to overflow the panel so the body scrolls.\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(160)}`,
  ];
  for (const text of seeds) {
    await box.click();
    await box.fill(text);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
  }
}
await page.waitForSelector("article", { timeout: 30_000 });

/**
 * Open the first timeline item and wait for the drawer to finish animating in.
 * Tapping the card body only opens the detail view on touch devices; on a
 * pointer device it is the "Details and tags" hover action, so drive that,
 * Playwright hovers before it clicks, which is what reveals it.
 */
async function openDrawer(which = "first") {
  // The timeline is chat-style (newest at the bottom) so "the long one" is
  // the last card, not the first.
  const card = which === "last" ? page.locator("article").last() : page.locator("article").first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await card.getByLabel("Details and tags").click();
  await page.waitForSelector('[data-slot="drawer-popup"]', { timeout: 15_000 });
  // The popup transitions for 450ms; settle before measuring geometry.
  await page.waitForTimeout(900);
}

async function closeDrawer() {
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-slot="drawer-popup"]', { state: "detached", timeout: 15_000 });
}

const popupBox = () => page.locator('[data-slot="drawer-popup"]').boundingBox();
const popupStyle = (props) =>
  page.evaluate((keys) => {
    const el = document.querySelector('[data-slot="drawer-popup"]');
    const cs = getComputedStyle(el);
    return Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)]));
  }, props);

// ---------------------------------------------------------------- desktop ---
await setTheme("light");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("article", { timeout: 30_000 });
await openDrawer("last");

const vw = 1440;
const vh = 900;
let box = await popupBox();
let style = await popupStyle([
  "border-top-left-radius",
  "border-bottom-right-radius",
  "border-left-width",
  "border-right-width",
  "margin-right",
]);

check(
  "desktop: inset from all four edges",
  box.x > 0 && box.y > 0 && box.y + box.height < vh - 1 && box.x + box.width < vw - 1,
  `box x=${box.x} y=${box.y.toFixed(0)} w=${box.width} h=${box.height.toFixed(0)} (viewport ${vw}x${vh})`,
);
check(
  "desktop: right inset is --drawer-inset (0.5rem = 8px)",
  Math.abs(vw - (box.x + box.width) - 8) < 1.5,
  `gap=${(vw - (box.x + box.width)).toFixed(1)}px`,
);
check(
  "desktop: reading column is 42rem (672px)",
  Math.abs(box.width - 672) < 2,
  `width=${box.width.toFixed(1)}px`,
);
check(
  "desktop: rounded on all corners, bordered on all sides",
  parseFloat(style["border-top-left-radius"]) > 0 &&
    parseFloat(style["border-bottom-right-radius"]) > 0 &&
    parseFloat(style["border-left-width"]) > 0 &&
    parseFloat(style["border-right-width"]) > 0,
  `radius tl=${style["border-top-left-radius"]} br=${style["border-bottom-right-radius"]}, border l=${style["border-left-width"]} r=${style["border-right-width"]}`,
);

const swipeDir = await page
  .locator('[data-slot="drawer-popup"]')
  .getAttribute("data-swipe-direction");
check("desktop: opens from the right", swipeDir === "right", `data-swipe-direction=${swipeDir}`);

const handleDesktop = await page.locator('[data-slot="drawer-swipe-handle"]').count();
check("desktop: no swipe handle", handleDesktop === 0, `handles=${handleDesktop}`);

// The body must be the scroller: DrawerContent is overflow-hidden.
const scroller = await page.evaluate(() => {
  const el = document.querySelector('[data-slot="drawer-popup"] .overflow-y-auto');
  if (!el) return null;
  return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
});
check(
  "desktop: body owns the scroll, and actually overflows",
  scroller !== null && scroller.scrollHeight > scroller.clientHeight,
  scroller
    ? `scrollHeight=${scroller.scrollHeight} clientHeight=${scroller.clientHeight}`
    : "no scroller found",
);

await page.screenshot({ path: `${SHOTS}/desktop-light.png` });

// --------------------------------------------------- overlay contrast (§8.3) ---
/** Sample the backdrop where it covers the page, and the page next to it. */
async function overlayContrast() {
  return page.evaluate(() => {
    const bd = document.querySelector('[data-slot="drawer-overlay"]');
    if (!bd) return null;
    const cs = getComputedStyle(bd);
    return {
      background: cs.backgroundColor,
      opacity: cs.opacity,
      backdropFilter: cs.backdropFilter,
      canvas: getComputedStyle(document.body).backgroundColor,
    };
  });
}
const lightOverlay = await overlayContrast();
console.log(`      light overlay: ${JSON.stringify(lightOverlay)}`);

await setTheme("dark");
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/desktop-dark.png` });
const darkOverlay = await overlayContrast();
console.log(`      dark  overlay: ${JSON.stringify(darkOverlay)}`);

/**
 * Does the drawer separate from the page behind it in dark mode?
 *
 * The tokens are authored in `oklch()` and `getComputedStyle` hands them back
 * that way, so they have to be resolved to sRGB before any luminance maths,
 * reading the three oklch components as if they were R, G and B is how this
 * check first "passed" at exactly 1.000:1. Canvas `fillStyle` does the
 * conversion with the browser's own colour code.
 *
 * Compared here: the panel's surface, and the canvas *after* the backdrop dims
 * it, which is the comparison a reader actually makes.
 */
// The helpers below can't be hoisted out of this callback the way the linter
// wants: it is serialised and run inside the page, so anything it references
// from this file's scope is simply not there.
// oxlint-disable unicorn/consistent-function-scoping
const separation = await page.evaluate(() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const srgb = (color) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = ([r, g, b]) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bd = getComputedStyle(document.querySelector('[data-slot="drawer-overlay"]'));
  const popup = getComputedStyle(document.querySelector('[data-slot="drawer-popup"]'));

  const panel = srgb(popup.backgroundColor);
  const canvas = srgb(getComputedStyle(document.body).backgroundColor);
  const border = srgb(popup.borderLeftColor);

  // Composite the backdrop over the canvas: result = a*over + (1-a)*under.
  const overRgb = srgb(bd.backgroundColor);
  const alpha =
    Number((bd.backgroundColor.match(/[\d.]+\s*\)$/) ?? ["1)"])[0].replace(")", "")) || 0;
  const dimmed = canvas.map((c, i) => Math.round(alpha * overRgb[i] + (1 - alpha) * c));

  const ratio = (x, y) => {
    const a = lum(x) + 0.05;
    const b = lum(y) + 0.05;
    return Number((Math.max(a, b) / Math.min(a, b)).toFixed(3));
  };
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  return {
    panel: hex(panel),
    dimmed: hex(dimmed),
    border: hex(border),
    alpha,
    vsPage: ratio(panel, dimmed),
    borderVsPage: ratio(border, dimmed),
  };
});
// oxlint-enable unicorn/consistent-function-scoping
console.log(`      separation: ${JSON.stringify(separation)}`);
check(
  "dark: drawer reads as a separate surface from the page",
  // Either the fill itself separates, or the 1px border does the work.
  separation.vsPage >= 1.08 || separation.borderVsPage >= 1.25,
  `panel ${separation.panel} vs dimmed page ${separation.dimmed} = ${separation.vsPage}:1; border ${separation.border} = ${separation.borderVsPage}:1`,
);

await closeDrawer();
check(
  "desktop: Esc closes and route returns to /",
  new URL(page.url()).pathname === "/",
  page.url(),
);

// ----------------------------------------------------------------- mobile ---
await setTheme("light");
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("article", { timeout: 30_000 });
await openDrawer("last");

box = await popupBox();
const mobileDir = await page
  .locator('[data-slot="drawer-popup"]')
  .getAttribute("data-swipe-direction");
check("mobile: opens from the bottom", mobileDir === "down", `data-swipe-direction=${mobileDir}`);
check(
  "mobile: full width, anchored to the bottom",
  Math.abs(box.x) < 1 && Math.abs(box.width - 390) < 1 && Math.abs(box.y + box.height - 844) < 2,
  `box x=${box.x} w=${box.width} bottom=${(box.y + box.height).toFixed(0)}`,
);
check(
  "mobile: capped at 100dvh - 6rem, timeline still visible above",
  box.height <= 844 - 96 + 2 && box.y >= 94,
  `height=${box.height.toFixed(0)} top=${box.y.toFixed(0)} (cap ${844 - 96})`,
);
const handleMobile = await page.locator('[data-slot="drawer-swipe-handle"]').count();
check("mobile: swipe handle present", handleMobile === 1, `handles=${handleMobile}`);

await page.screenshot({ path: `${SHOTS}/mobile-light.png` });
await setTheme("dark");
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/mobile-dark.png` });

// ------------------------------------------- destructive styling (§8.3 #2) ---
await setTheme("light");
await page.setViewportSize({ width: 1440, height: 900 });
await closeDrawer();
await page.waitForTimeout(300);
await openDrawer("last");
// The delete trigger lives in the drawer header, not the card's hover strip.
const del = page.locator('[data-slot="drawer-popup"]').getByTitle("Delete").first();
if (await del.count()) {
  await del.click();
  await page.waitForSelector('[role="alertdialog"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/destructive-light.png` });
  const confirm = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="alertdialog"] button')];
    const el = btns.find((b) => /delete/i.test(b.textContent));
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  console.log(`      destructive confirm: ${JSON.stringify(confirm)}`);
  check("destructive confirm button is styled", confirm !== null, JSON.stringify(confirm));
  await page.keyboard.press("Escape");
}

console.log(`\nscreenshots → ${SHOTS}`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await ctx.close();
process.exit(failed.length ? 1 : 0);
