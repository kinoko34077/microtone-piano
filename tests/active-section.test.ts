import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {encodeAddress, isPlayableAddress} from '../src/core/address';
import {STANDARD_LAYOUT_256TEST} from '../src/core/presets';
import {getLaneDisplaySegments, getDepthFromDisplaySegments} from '../src/core/laneBoundaries';

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

test('#38 nonuniform active boundaries survive the invalid-slot preview without hit-test drift', () => {
  const layout = {...STANDARD_LAYOUT_256TEST};
  const lane = {activeDepths: 2, customBoundaries: [0, 0.8, 1]};
  const preview = getLaneDisplaySegments(layout, lane, false, true);
  assert.equal(preview.length, 8);
  assert.deepEqual(preview.map(segment => segment.depth), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(preview.map(segment => segment.isInvalid), [true, true, true, true, true, true, false, false]);
  // Six fixed guides (75%); the two active sections share the remaining 25%
  // according to the user's 80/20 boundary, not an obsolete 50/50 split.
  assert.ok(Math.abs(preview[6].heightPercent - 20) < 1e-9);
  assert.ok(Math.abs(preview[7].heightPercent - 5) < 1e-9);
  assert.ok(Math.abs(preview.reduce((sum, segment) => sum + segment.heightPercent, 0) - 100) < 1e-9);
  assert.equal(getDepthFromDisplaySegments(0.60, preview), 3, 'inactive preview retains its address');
  assert.equal(getDepthFromDisplaySegments(0.80, preview), 1, 'active depth one occupies 75..95%');
  assert.equal(getDepthFromDisplaySegments(0.98, preview), 0, 'active depth zero occupies 95..100%');
  assert.deepEqual(
    getLaneDisplaySegments(layout, lane, false, false).map(segment => segment.heightPercent),
    [80, 19.999999999999996],
    'hidden-invalid mode preserves the existing full-height active key',
  );
});

test('#38 0/1/8-depth white and black preview use the same drawable and hittable intervals', () => {
  const layout = {...STANDARD_LAYOUT_256TEST};
  for (const isBlack of [false, true]) {
    for (const count of [0, 1, 2, 8]) {
      const lane = {activeDepths: count};
      const preview = getLaneDisplaySegments(layout, lane, isBlack, true);
      assert.equal(preview.length, 8);
      assert.equal(preview.filter(segment => segment.isInvalid).length, 8 - count);
      assert.ok(Math.abs(preview.reduce((sum, segment) => sum + segment.heightPercent, 0) - 100) < 1e-8);
      let position = 0;
      for (const segment of preview) {
        if (segment.heightPercent > 0.001) {
          const centerRatio = (position + segment.heightPercent / 2) / 100;
          assert.equal(getDepthFromDisplaySegments(centerRatio, preview), segment.depth);
        }
        position += segment.heightPercent;
      }
    }
  }
});

test('#38 keyboard rendering and hit test both call the canonical preview helper', () => {
  const source = readFileSync(new URL('../src/components/Keyboard/InteractiveKeyboard.tsx', import.meta.url), 'utf8');
  const calls = source.match(/getLaneDisplaySegments\(/g) ?? [];
  assert.ok(calls.length >= 4, 'both keyboard colors and both hit-test paths use canonical geometry');
  assert.ok(source.includes('getDepthFromDisplaySegments('));
  assert.ok(!source.includes('calculateDepthFromRatio('));
});
