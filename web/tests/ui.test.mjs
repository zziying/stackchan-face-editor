// Real-browser interaction smoke test against the running dev server.
// Run: node tests/ui.test.mjs [url]
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://localhost:5199';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle0' });
// a previous session's autosave would skew the baseline assertions
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.preview canvas');

// 0. first visit: the wizard bubble shows; ✕ dismisses it for good
assert.ok(await page.$('.wiz-bubble'), 'first-visit wizard bubble shown');
await page.evaluate(() => document.querySelector('.wiz-bubble-x').click());
assert.equal(await page.$('.wiz-bubble'), null, 'bubble dismissed');

// helper: panel by title, field row by label inside it
const row = async (panelTitle, label) => {
  const h = await page.evaluateHandle((pt, lb) => {
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.querySelector('summary')?.textContent.trim().startsWith(pt));
    if (!panel) return null;
    panel.open = true;
    return [...panel.querySelectorAll('.field')]
      .find((f) => f.querySelector('.field-label')?.textContent === lb) ?? null;
  }, panelTitle, label);
  assert.ok(await h.evaluate((e) => !!e), `row ${panelTitle}/${label}`);
  return h;
};
const numValue = (h) => h.evaluate((f) => parseFloat(f.querySelector('.field-num').value));

// 1. Eye L X slider responds (keyboard arrow on focused range)
let r = await row('Eye L', 'X');
assert.equal(await numValue(r), 230);
await (await r.evaluateHandle((f) => f.querySelector('input[type=range]'))).asElement().focus();
await page.keyboard.press('ArrowRight');
assert.equal(await numValue(r), 231, 'Eye L X moved');

// 2. symmetry lock mirrored Eye R (320 - 231 = 89)
r = await row('Eye R', 'X');
assert.equal(await numValue(r), 89, 'Eye R mirrored');

// 3. Mouth select works: shape -> omega
r = await row('Mouth', 'Shape');
await (await r.evaluateHandle((f) => f.querySelector('select'))).asElement().select('omega');
r = await row('Mouth', 'Shape');
assert.equal(await r.evaluate((f) => f.querySelector('select').value), 'omega', 'mouth shape set');

// 4. Brow enable checkbox adds both brows (sym lock)
await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('summary')?.textContent.trim().startsWith('Brow L'));
  panel.querySelector('summary input[type=checkbox]').click();
});
r = await row('Brow L', 'Width');
assert.equal(await numValue(r), 40, 'brow L added');
r = await row('Brow R', 'Width');
assert.equal(await numValue(r), 40, 'brow R added via lock');

// 5. expression tab: edit stores delta (dot appears), base stays clean
await page.evaluate(() => {
  [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.includes('happy')).click();
});
r = await row('Eye L', 'Upper lid');
await (await r.evaluateHandle((f) => f.querySelector('input[type=range]'))).asElement().focus();
await page.keyboard.press('ArrowRight');  // +0.01
const deltaMarked = await r.evaluate((f) => f.className.includes('field-delta'));
assert.ok(deltaMarked, 'delta highlight on');

// 5b. the default face ships with no factory deltas — every expression tab
//     starts as the base face; revert restores that pristine empty delta,
//     and clear wipes fresh edits the same way
await page.evaluate(() => {
  [...document.querySelectorAll('.expr-hint button')]
    .find((b) => b.textContent.startsWith('revert')).click();
});
r = await row('Eye L', 'Upper lid');
assert.equal(await numValue(r), 0, 'revert restored pristine (no factory delta)');
r = await row('Eye L', 'Lower lid');
await (await r.evaluateHandle((f) => f.querySelector('input[type=range]'))).asElement().focus();
await page.keyboard.press('ArrowRight');  // +0.01 fresh delta
await page.evaluate(() => {
  [...document.querySelectorAll('.expr-hint button')]
    .find((b) => b.textContent === 'clear')?.click();
});
r = await row('Eye L', 'Lower lid');
assert.equal(await numValue(r), 0, 'clear wiped delta');

// 5c. arc eye renders as a small stroke, not a giant ring (angle-swap
//     regression): switch base Eye L to arc, count lit pixels near the eye
await page.evaluate(() => {
  [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'base').click();
});
r = await row('Eye L', 'Shape');
await (await r.evaluateHandle((f) => f.querySelector('select'))).asElement().select('arc');
await new Promise((res) => setTimeout(res, 150));  // let a frame render
const arcPixels = await page.evaluate(() => {
  const c = document.querySelector('.preview canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 30) lit++;
  return lit;
});
// two small eyes + mouth ≈ a few hundred px; the complement-ring bug lit thousands
assert.ok(arcPixels > 50 && arcPixels < 3000, `arc pixel count sane, got ${arcPixels}`);

// 6. canvas actually drew something non-background
const painted = await page.evaluate(() => {
  const c = document.querySelector('.preview canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 30) return true;
  return false;
});
assert.ok(painted, 'canvas painted');

// 7. pixel-skin face via share hash: WASM decodes sprites, preview shows
//    the white eye discs and the pink blush overlay
const pixelDoc = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../faces/pixel-demo.json'), 'utf8'));
const hash = '#f=r' + Buffer.from(JSON.stringify(pixelDoc)).toString('base64url');
// fresh page: hash-only goto on the existing one wouldn't remount the app
const page2 = await browser.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(URL + '/' + hash, { waitUntil: 'networkidle0' });
await page2.waitForSelector('.preview canvas');
await new Promise((res) => setTimeout(res, 300));
const pix = await page2.evaluate(() => {
  const c = document.querySelector('.preview canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let white = 0, pink = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) white++;
    if (d[i] > 220 && d[i + 1] > 100 && d[i + 1] < 200 && d[i + 2] > 150) pink++;
  }
  return { white, pink };
});
assert.ok(pix.white > 100, `pixel eyes painted, white=${pix.white}`);
assert.ok(pix.pink > 100, `blush overlay painted, pink=${pix.pink}`);

// 7b. smooth toggle (P8): checkbox shows for pixel parts (scale 3 ≥ 2) and
//     lands in the doc; renderer correctness is covered by the native test
const smoothOk = await page2.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('summary')?.textContent.trim().startsWith('Eye L'));
  if (!panel) return 'no panel';
  panel.open = true;
  const field = [...panel.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'Smooth pixels');
  if (!field) return 'no field';
  const box = field.querySelector('input[type=checkbox]');
  if (!box) return 'no checkbox';
  box.click();
  return 'ok';
});
assert.equal(smoothOk, 'ok', `smooth toggle clickable: ${smoothOk}`);
const readDoc2 = async () => {
  await page2.evaluate(() => {
    const d = document.querySelector('.json-panel');
    if (!d.open) d.querySelector('summary').click();
  });
  await page2.waitForSelector('.json-view');
  return JSON.parse(await page2.$eval('.json-view', (el) => el.textContent));
};
const d7 = await readDoc2();
assert.equal(d7.parts.eyeL.smooth, true, 'smooth landed in doc');

// 7c. per-expression overlay (v2.1): the fixture gives angry an own red-vein
//     frame and hides the overlay on sleepy; mode buttons reflect + edit it
const gotoTab = (name) => page2.evaluate((n) => {
  [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.includes(n)).click();
}, name);
const countOverlay = () => page2.evaluate(() => {
  const c = document.querySelector('.preview canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let pink = 0, red = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 220 && d[i + 1] > 100 && d[i + 1] < 200 && d[i + 2] > 150) pink++;
    if (d[i] > 190 && d[i + 1] < 100 && d[i + 2] < 100) red++;
  }
  return { pink, red };
});
await gotoTab('angry');
await new Promise((res) => setTimeout(res, 200));
let ov = await countOverlay();
assert.ok(ov.red > 20 && ov.pink < 20, `angry swaps to vein: red=${ov.red} pink=${ov.pink}`);
await gotoTab('sleepy');
await new Promise((res) => setTimeout(res, 200));
ov = await countOverlay();
assert.ok(ov.red < 20 && ov.pink < 20, `sleepy hides overlay: red=${ov.red} pink=${ov.pink}`);
const activeMode = await page2.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('summary')?.textContent.trim().startsWith('Overlay'));
  panel.open = true;
  return panel.querySelector('.frame-tabs .mini.active')?.textContent;
});
assert.equal(activeMode, 'hidden', 'sleepy tab shows hidden mode');
await gotoTab('happy');
await page2.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('summary')?.textContent.trim().startsWith('Overlay'));
  panel.open = true;
  [...panel.querySelectorAll('.frame-tabs .mini')].find((b) => b.textContent === 'hidden').click();
});
const d7c = await readDoc2();
assert.equal(d7c.overlay.expr.happy.hidden, true, 'hidden mode landed in doc');

// 7d. per-expression part frames (v3): the fixture gives happy own golden
//     eye frames; the inherit/own buttons reflect and edit them, and the
//     symmetry lock keeps both eyes paired
const countGold = () => page2.evaluate(() => {
  const c = document.querySelector('.preview canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let gold = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 240 && d[i + 2] < 90) gold++;
  return gold;
});
const eyeFrameMode = (action) => page2.evaluate((act) => {
  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('summary')?.textContent.trim().startsWith('Eye L'));
  panel.open = true;
  if (act === 'read')
    return panel.querySelector('.part-frame-mode .mini.active')?.textContent;
  [...panel.querySelectorAll('.part-frame-mode .mini')]
    .find((b) => b.textContent === act).click();
}, action);
// still on the happy tab from 7c
await new Promise((res) => setTimeout(res, 200));
assert.ok(await countGold() > 20, `happy renders its own golden eye frames, got ${await countGold()}`);
assert.equal(await eyeFrameMode('read'), 'own frames', 'happy eye board sits on own frames');
await eyeFrameMode('inherit base');
await new Promise((res) => setTimeout(res, 200));
assert.ok(await countGold() < 20, 'inherit base dropped the own frames');
let d7d = await readDoc2();
assert.equal(d7d.expressions?.happy?.parts?.eyeL?.frames, undefined, 'own frames removed from doc');
assert.equal(d7d.expressions?.happy?.parts?.eyeR?.frames, undefined, 'sym lock cleared the partner too');
// own on a clean expression seeds a copy of the base pair for both sides
await gotoTab('sad');
await eyeFrameMode('own frames');
d7d = await readDoc2();
assert.equal(d7d.expressions.sad.parts.eyeL.frames.open.data,
  d7d.parts.eyeL.frames.open.data, 'own frames seeded from a base copy');
assert.ok(d7d.expressions.sad.parts.eyeR.frames.open.data.length > 0,
  'sym lock seeded the partner');

// 8. pixel board (back on the first page): switch Eye L to pixel, paint one
//    cell, doc gains frames.open; the whole stroke is a single undo step
let r8 = await row('Eye L', 'Shape');
await (await r8.evaluateHandle((f) => f.querySelector('select'))).asElement().select('pixel');
await page.waitForSelector('.pixel-board canvas');
const bb = await (await page.$('.pixel-board canvas')).boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);

const readDoc = async () => {
  await page.evaluate(() => {
    const d = document.querySelector('.json-panel');
    if (!d.open) d.querySelector('summary').click();
  });
  await page.waitForSelector('.json-view');
  return JSON.parse(await page.$eval('.json-view', (el) => el.textContent));
};
let d8 = await readDoc();
assert.equal(d8.parts.eyeL.shape, 'pixel', 'shape switched');
assert.ok(d8.parts.eyeL.frames?.open?.data?.length > 0, 'stroke committed a frame');
assert.ok(Array.isArray(d8.parts.eyeL.frames.open.palette), 'frame carries palette');
// sym lock mirrored the shape change, so eyeR is pixel and gets a flipped copy (P7)
assert.equal(d8.parts.eyeR.shape, 'pixel', 'shape mirrored to eyeR');
assert.ok(d8.parts.eyeR.frames?.open?.data?.length > 0, 'flipped frame copied to eyeR');

await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent === '↶').click());
d8 = await readDoc();
assert.equal(d8.parts.eyeL.frames, undefined, 'one stroke = one undo step');
assert.equal(d8.parts.eyeL.shape, 'pixel', 'undo kept the shape change');

// 9. splitter drag widens the control column
const sb = await (await page.$('.splitter')).boundingBox();
const rightBefore = await page.evaluate(() =>
  document.querySelector('.right').getBoundingClientRect().width);
await page.mouse.move(sb.x + 2, sb.y + 200);
await page.mouse.down();
await page.mouse.move(sb.x - 78, sb.y + 200, { steps: 5 });
await page.mouse.up();
const rightAfter = await page.evaluate(() =>
  document.querySelector('.right').getBoundingClientRect().width);
assert.ok(rightAfter > rightBefore + 50, `splitter widened right col: ${rightBefore} -> ${rightAfter}`);

// 10. grid size waits for ✓: typing alone doesn't commit, apply resizes
//     (eyeL is pixel from section 8; its stroke was undone, frames absent).
//     Set the value via the native setter: ElementHandle.click() hangs on
//     inputs scrolled out of the viewport, and triple-click-select doesn't
//     take on number inputs.
await page.evaluate(() => {
  const inp = document.querySelector('.frame-size input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '12');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
let d10 = await readDoc();
assert.equal(d10.parts.eyeL.frames?.open?.w, undefined, 'typing alone did not commit');
await page.evaluate(() => document.querySelector('.frame-size .apply').click());
d10 = await readDoc();
assert.equal(d10.parts.eyeL.frames.open.w, 12, 'apply resized the frame');

// 11. autosave: reload restores the working face; New resets to default
await new Promise((res) => setTimeout(res, 600));  // let the debounced save land
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.preview canvas');
let d11 = await readDoc();
assert.equal(d11.parts.eyeL.frames?.open?.w, 12, 'reload restored progress');
page.once('dialog', (d) => d.accept());
await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent === 'New').click());
d11 = await readDoc();
assert.equal(d11.parts.eyeL.shape, 'ellipse', 'New reset to the default face');
assert.equal(d11.parts.eyeL.frames, undefined, 'New dropped the pixel frames');

// 12. wizard: starting pixel-converts the eyes; painting the open frame and
//     stepping forward lays out a squashed closed draft and lands the panel
//     on the closed tab; the done step runs the talking demo; finish closes.
await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent === 'Wizard').click());
await page.waitForSelector('.wizard');
// start step: pick a starting point before any drawing
assert.ok(await page.$('.wiz-choices'), 'start step offers choices');
await page.evaluate(() =>
  [...document.querySelectorAll('.wiz-choices button')]
    .find((b) => b.textContent === 'start fresh').click());
await page.waitForSelector('#panel-eyeL .pixel-board canvas');
assert.ok(await page.$('.wiz-float'), 'floating wizard next button shown');
assert.ok(await page.evaluate(() =>
  [...document.querySelectorAll('#panel-eyeL .pixel-tools button')]
    .some((b) => b.textContent.includes('↩'))), 'undo lives in the board toolbar');
let d12 = await readDoc();
assert.equal(d12.parts.eyeL.shape, 'pixel', 'wizard pixel-converted eyeL');
assert.equal(d12.parts.eyeR.shape, 'pixel', 'wizard pixel-converted eyeR');

// the wizard smooth-scrolls the panel into view: cancel that with an
// instant scroll so the canvas holds still, then click its center
await page.$eval('#panel-eyeL .pixel-board canvas', (el) =>
  el.scrollIntoView({ block: 'center' }));
const wb = await (await page.$('#panel-eyeL .pixel-board canvas')).boundingBox();
await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height / 2);
d12 = await readDoc();
assert.ok(d12.parts.eyeL.frames?.open?.data?.length > 0, 'wizard stroke painted the open frame');
await page.evaluate(() => document.querySelector('.wiz-actions .wiz-primary').click());
// the draft lands via the step effect one commit after the click — wait for
// it to reach the (already open) JSON view instead of reading immediately
// interval polling: the default raf polling stalls when headless Chrome
// throttles animation frames, timing out on a condition that is true
await page.waitForFunction(
  () => document.querySelector('.json-view')?.textContent.includes('"closed"'),
  { timeout: 3000, polling: 120 });
d12 = await readDoc();
assert.ok(d12.parts.eyeL.frames?.closed?.data?.length > 0, 'closed draft generated');
assert.ok(d12.parts.eyeR.frames?.closed?.data?.length > 0, 'closed draft mirrored');
const activeTab = await page.$eval('#panel-eyeL .frame-tabs button.active', (el) => el.textContent);
assert.ok(activeTab.includes('eyes closed'), `board landed on the closed tab, got: ${activeTab}`);

await page.evaluate(() => [...document.querySelectorAll('.wiz-chip')].at(-1).click());
const talking = await page.$eval('.face-toggles .toggle:nth-of-type(2) input', (el) => el.checked);
assert.ok(talking, 'done step runs the talking demo');
// the done step spells out the device path (connect button or fallback text)
assert.ok(await page.$('.wiz-sub'), 'done step explains how to reach a device');
await page.evaluate(() =>
  [...document.querySelectorAll('.wiz-actions button')].find((b) => b.textContent === 'finish').click());
assert.equal(await page.$('.wizard'), null, 'finish closed the wizard');
assert.equal(
  await page.$eval('.face-toggles .toggle:nth-of-type(2) input', (el) => el.checked),
  false, 'demo stopped with the wizard');

// 13. broken share hash: keeps the saved face and toasts instead of silence
// (about:blank detour — a same-URL hash change is a same-document navigation
// and would not remount the app, so the decode effect would never rerun)
// autosave is debounced 400ms: let the wizard's face reach localStorage
// before navigating away, or the reload falls back to the default face
await page.waitForFunction(
  () => (localStorage.getItem('pf-doc') ?? '').includes('"shape":"pixel"'),
  { timeout: 3000, polling: 120 });
await page.goto('about:blank');
await page.goto(URL + '/#f=z_not_valid_', { waitUntil: 'networkidle0' });
await page.waitForSelector('.toast', { timeout: 3000 });
const toastText = await page.$eval('.toast', (el) => el.textContent);
assert.ok(toastText.includes('broken share link'), `broken-link toast, got: ${toastText}`);
await page.waitForSelector('.preview canvas');
const d13 = await readDoc();
assert.equal(d13.parts.eyeL.shape, 'pixel', 'saved face survived the bad link');

// 14. preset gallery: thumbnails render, picking loads the face, undo reverts
await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent === 'Presets').click());
await page.waitForFunction(
  () => document.querySelectorAll('.preset-card img').length === 5,
  { timeout: 5000, polling: 120 });
await page.evaluate(() =>
  [...document.querySelectorAll('.preset-card')]
    .find((c) => c.textContent.includes('Mochi')).click());
assert.equal(await page.$('.preset-pop'), null, 'gallery closed after pick');
let d14 = await readDoc();
assert.equal(d14.meta.name, 'Mochi', 'preset loaded');
assert.equal(d14.palette.background, '#181826', 'preset content applied');
await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent === '↶').click());
d14 = await readDoc();
assert.notEqual(d14.meta.name, 'Mochi', 'one undo step brings the old face back');

// 15. Live-sculpt hub: header entry, guide, both channels, inline error
await page.evaluate(() =>
  [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Live sculpt').click());
await page.waitForSelector('.device-hub');
assert.equal(await page.$eval('.hub-guide', (d) => d.open), false, 'flashing guide collapsed');
assert.ok(await page.$eval('.hub-guide', (d) => d.textContent.includes('arduino-cli')), 'guide has commands');
assert.equal((await page.$$('.hub-channel')).length, 2, 'serial + wifi channels on http origin');
await page.evaluate(() => {
  const inp = document.querySelector('.device-hub .http-host');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '127.0.0.1:1');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() =>
  [...document.querySelectorAll('.device-hub button')].find((b) => b.textContent.trim() === 'Connect').click());
await page.waitForSelector('.hub-err', { timeout: 8000 });
await page.evaluate(() => document.querySelector('.device-hub .wiz-close').click());
assert.equal(await page.$('.device-hub'), null, 'hub closes');

assert.deepEqual(errors, [], `no page errors, got: ${errors}`);
console.log('ui tests passed');
await browser.close();
