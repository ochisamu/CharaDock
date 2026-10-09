// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..', 'remote');
const source = fs.readFileSync(path.join(root, 'remote.js'), 'utf8');

function fixture({ dialogOpen = false } = {}) {
  const avatar = {}, control = {};
  const stage = { left: 0, top: 0, right: 430, bottom: 716 };
  // Deliberately overlap the stage: a tall composer/short viewport can do so.
  const dock = { left: 10, top: 650, right: 420, bottom: 890 };
  const elements = {
    '#avatarTapTarget': { contains: target => target === avatar },
    '.avatar-stage': { getBoundingClientRect: () => stage },
    '.control-dock': { getBoundingClientRect: () => dock },
  };
  const start = source.indexOf('  function isCharacterPointerEvent(event) {');
  const end = source.indexOf('  async function tapCharacter(event) {', start);
  assert.ok(start >= 0 && end > start);
  const allows = vm.runInNewContext(`${source.slice(start,end)};isCharacterPointerEvent`, {
    $: selector => elements[selector], document: { querySelector: () => dialogOpen ? {} : null },
  });
  const event = (x, y, overrides = {}) => ({ target: avatar, type: 'click', detail: 1, clientX: x, clientY: y, ...overrides });
  return { allows, avatar, control, event };
}

test('character hits never override dock buttons or padding, even with stale browser targeting', () => {
  const { allows, event } = fixture();
  for (const [x,y] of [[20,651],[200,680],[419,715],[200,800],[200,889]]) assert.equal(allows(event(x,y)), false);
  assert.equal(allows(event(200,400)), true);
  assert.equal(allows(event(200,649)), true);
});
test('clipped character and unrelated controls cannot trigger a pet reaction', () => {
  const { allows, control, event } = fixture();
  assert.equal(allows(event(200,400,{target:control})), false);
  for (const point of [[-1,400],[431,400],[200,-1],[425,716],[425,850]]) assert.equal(allows(event(...point)), false);
});
test('keyboard character activation stays accessible without overriding dialogs', () => {
  const { allows, event } = fixture();
  assert.equal(allows(event(0,0,{detail:0})), true);
  const modal = fixture({dialogOpen:true});
  assert.equal(modal.allows(modal.event(200,400)), false);
  assert.equal(modal.allows(modal.event(0,0,{detail:0})), false);
});
test('visual press and character action both check the protected control region first', () => {
  assert.match(source, /async function tapCharacter\(event\) \{\s*if \(!isCharacterPointerEvent\(event\)\) return;/);
  const pointer = source.slice(source.indexOf('$("#avatarTapTarget").addEventListener("pointerdown"'),source.indexOf('for (const type of ["pointerup"'));
  assert.ok(pointer.includes('if (!isCharacterPointerEvent(event)) return;'));
  assert.ok(pointer.indexOf('if (!isCharacterPointerEvent(event)) return;') < pointer.indexOf('classList.add("is-pressed")'));
});
test('the character composition is isolated below the fixed control dock', () => {
  const css = fs.readFileSync(path.join(root,'remote.css'),'utf8');
  assert.match(css,/\.avatar-stage \{[^}]*z-index: 0;[^}]*isolation: isolate;/);
  assert.match(css,/\.control-dock \{[^}]*z-index: 12;[^}]*isolation: isolate;[^}]*pointer-events: auto;/);
  assert.match(css,/\.avatar-layer \{[^}]*pointer-events: none;/);
});
