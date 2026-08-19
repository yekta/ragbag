// Acceptance harness for the hover rungs in src/index.css. No browser and no
// dev stack: it reads the token block straight out of the stylesheet, so it
// runs anywhere and cannot drift from what ships.
//
// The bug it exists to catch: the light theme used to pack every neutral it
// owns into the 0.063 between the canvas and --border, against dark's 0.105,
// which left hovers there two to eight times weaker than the same hover in
// dark. Nothing failed, nothing looked broken in isolation, and the only way
// to see it was to put the two themes side by side. A number is cheaper.
//
// Each pair below is a rest fill and the fill it takes under the pointer. The
// step between them is measured in OKLCH L, which is what the tokens are
// written in and is near enough perceptually uniform that the same number
// means the same thing at either end of the scale. `bordered` marks a control
// with an edge of its own to lose, which additionally has to stay clear of
// --border rather than running into it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = fileURLToPath(new URL("../src/index.css", import.meta.url));

const MIN_STEP = 0.04; // under this a hover stops reading as a state change
const MAX_SKEW = 2.0; // one theme may not be more than this much louder than the other
const MIN_CLEARANCE = 0.018; // how much of a gap a bordered fill leaves its own border

const PAIRS = [
  { name: "outline button, canvas", rest: "background", hover: "background-hover", bordered: true },
  { name: "bordered row, card", rest: "card", hover: "background-hover", bordered: true },
  { name: "ghost control, canvas", rest: "background", hover: "hover" },
  { name: "ghost control, card", rest: "card", hover: "hover" },
  { name: "menu item", rest: "popover", hover: "accent" },
  { name: "selected nav row", rest: "sidebar-accent", hover: "sidebar-accent-hover" },
  { name: "secondary button", rest: "secondary", hover: "secondary-hover" },
  { name: "destructive button", rest: "destructive-soft", hover: "destructive-soft-hover" },
  // --panel sits under --border in dark already, so a panel row's fill passes
  // its own edge on the way up. That predates the rungs and is why this pair
  // is not marked bordered: the clearance is not there to be kept.
  { name: "panel row", rest: "panel", hover: "panel-hover" },
];

function themes() {
  const css = readFileSync(CSS, "utf8");
  const grab = (start) => {
    const at = css.indexOf(start);
    const block = css.slice(at, css.indexOf("\n}", at));
    const out = {};
    for (const [, k, v] of block.matchAll(/--([a-z-]+):\s*oklch\(([\d.]+)/g)) out[k] = Number(v);
    return out;
  };
  return { light: grab(":root {"), dark: grab(".dark {") };
}

const { light, dark } = themes();
const rows = [];
let failed = 0;

for (const pair of PAIRS) {
  const step = (t) => {
    const [rest, hover] = [t[pair.rest], t[pair.hover]];
    if (rest === undefined || hover === undefined)
      throw new Error(`unknown token in pair "${pair.name}": ${pair.rest} / ${pair.hover}`);
    return { step: Math.abs(rest - hover), clearance: Math.abs(hover - t.border) };
  };
  const l = step(light);
  const d = step(dark);
  const skew = Math.max(l.step, d.step) / Math.min(l.step, d.step);
  const problems = [];
  if (l.step < MIN_STEP) problems.push(`light step ${l.step.toFixed(3)} < ${MIN_STEP}`);
  if (d.step < MIN_STEP) problems.push(`dark step ${d.step.toFixed(3)} < ${MIN_STEP}`);
  if (skew > MAX_SKEW) problems.push(`themes ${skew.toFixed(1)}x apart, max ${MAX_SKEW}x`);
  if (pair.bordered) {
    if (l.clearance < MIN_CLEARANCE)
      problems.push(`light fill ${l.clearance.toFixed(3)} off its border`);
    if (d.clearance < MIN_CLEARANCE)
      problems.push(`dark fill ${d.clearance.toFixed(3)} off its border`);
  }
  if (problems.length) failed++;
  rows.push({ pair, l, d, skew, problems });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("pair", 26)}${pad("light", 8)}${pad("dark", 8)}${pad("skew", 7)}edge`);
for (const { pair, l, d, skew, problems } of rows) {
  const edge = pair.bordered ? `${l.clearance.toFixed(3)} / ${d.clearance.toFixed(3)}` : "-";
  console.log(
    `${problems.length ? "✗" : "✓"} ${pad(pair.name, 24)}${pad(l.step.toFixed(3), 8)}` +
      `${pad(d.step.toFixed(3), 8)}${pad(skew.toFixed(1) + "x", 7)}${edge}`,
  );
  for (const p of problems) console.log(`    ${p}`);
}

if (failed) {
  console.error(`\n${failed} of ${rows.length} hover pairs are out of range.`);
  process.exit(1);
}
console.log(`\nall ${rows.length} hover pairs in range.`);
