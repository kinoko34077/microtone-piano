import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {encodeAddress, isPlayableAddress} from '../src/core/address';
import {STANDARD_LAYOUT_256TEST} from '../src/core/presets';

test('#38 inactive lane depth cannot play even when its old mapping is retained', () => {
  const layout = {
    ...STANDARD_LAYOUT_256TEST,
    lanes: STANDARD_LAYOUT_256TEST.lanes.map((lane) => ({...lane})),
  };
  const active = encodeAddress(2, false, 1);
  const inactive = encodeAddress(2, false, 7);
  assert.ok(layout.mapping[inactive] >= 0, 'test requires a mapped inactive section');

  assert.equal(isPlayableAddress(layout, inactive), true);
  layout.lanes[4].activeDepths = 2;
  assert.equal(isPlayableAddress(layout, active), true);
  assert.equal(isPlayableAddress(layout, inactive), false);
  assert.ok(layout.mapping[inactive] >= 0, 'existing mapping is not erased by playability checks');
  layout.lanes[4].activeDepths = 8;
  assert.equal(isPlayableAddress(layout, inactive), true, 'reactivation restores address meaning');
});

test('#38 white/black lanes and 0/1/8 depth boundaries are handled independently', () => {
  const layout = {
    ...STANDARD_LAYOUT_256TEST,
    lanes: STANDARD_LAYOUT_256TEST.lanes.map((lane) => ({...lane})),
  };
  const white = encodeAddress(15, false, 0);
  const black = encodeAddress(15, true, 7);
  layout.lanes[30].activeDepths = 0;
  layout.lanes[31].activeDepths = 8;
  assert.equal(isPlayableAddress(layout, white), false);
  assert.equal(isPlayableAddress(layout, black), true);

  layout.lanes[30].activeDepths = 1;
  layout.lanes[31].activeDepths = 1;
  assert.equal(isPlayableAddress(layout, white), true);
  assert.equal(isPlayableAddress(layout, encodeAddress(15, false, 1)), false);
  assert.equal(isPlayableAddress(layout, black), false);
  assert.equal(isPlayableAddress(layout, encodeAddress(15, true, 0)), true);
});

test('#38 invalid addresses never pass the active-depth guard', () => {
  for (const value of [-1, 256, 4096, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isPlayableAddress(STANDARD_LAYOUT_256TEST, value), false);
  }
});

test('#38 glissando checks playability before touching the pressed visual set', () => {
  const source = readFileSync(new URL('../src/components/Keyboard/InteractiveKeyboard.tsx', import.meta.url), 'utf8');
  const from = source.indexOf('const processPointerMove = useCallback(');
  const to = source.indexOf('const flushPointerMoves = useCallback(', from);
  assert.ok(from >= 0 && to > from);
  const move = source.slice(from, to);
  const guard = move.indexOf('const playable = baseAddress !== null &&');
  const address = move.indexOf('const newAddress = playable ? hitAddress : null');
  const highlight = move.indexOf('setPressedAddresses(');
  assert.ok(guard >= 0 && address > guard && highlight > address,
    'An inactive/unassigned hit must be rejected before rendering a highlight');
  assert.match(move, /resolvePitch\(pitchRef, tuning\)\.pitchDef !== null/);
});
