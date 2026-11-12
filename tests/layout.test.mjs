import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('foldable/Mac layout rules exist and phone-size layout is not changed by them', () => {
  const css = read('../assets/app.css');
  assert.match(css, /html, body \{[^}]*overscroll-behavior: none/);
  assert.match(css, /touch-action: manipulation/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(min-width: 760px\)[\s\S]*\.overlay \{ align-items: center/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  // Hover must never be the only way to do something: no hover rule may reveal hidden controls.
  const hoverBlock = css.slice(css.indexOf('@media (hover: hover) and (pointer: fine)'));
  assert.doesNotMatch(hoverBlock, /display\s*:|visibility\s*:|opacity\s*:\s*1/);
  // Inputs keep 16px (no iOS focus zoom).
  assert.match(css, /\.add-bar input \{[^}]*font-size: 16px/);
});

test('the build stamp in version.js matches VERSION in sw.js', () => {
  const stamp = read('../src/version.js').match(/APP_BUILD = ["']([^"']+)["']/)[1];
  assert.equal(read('../sw.js').match(/const VERSION = ["']([^"']+)["']/)[1], stamp);
  assert.equal(stamp, '2026.11.12-foldable1');
});
