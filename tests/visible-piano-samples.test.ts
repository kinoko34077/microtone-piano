import test from 'node:test';
import assert from 'node:assert/strict';
import {getKeyboardColumnRange} from '../src/core/keyboardRange';
import {getVisiblePianoFrequencies} from '../src/core/visiblePianoSamples';
import {STANDARD_LAYOUT_12EDO, STANDARD_TUNING_12EDO, STANDARD_LAYOUT_256TEST} from '../src/core/presets';
import {encodeAddress} from '../src/core/address';
import {findNearestPianoSample} from '../src/core/pianoSamples';

test('#30 visible-only samples track the actual playable rendered period and scrolling', () => {
  const range = getKeyboardColumnRange(STANDARD_LAYOUT_12EDO, STANDARD_TUNING_12EDO, 0);
  const c4 = -range.startColumn;
  const visible = getVisiblePianoFrequencies(STANDARD_LAYOUT_12EDO, STANDARD_TUNING_12EDO, range, c4, c4);
  const nextPeriod = getVisiblePianoFrequencies(STANDARD_LAYOUT_12EDO, STANDARD_TUNING_12EDO,
    range, c4 + range.period, c4 + range.period);
  assert.ok(visible.length >= 1);
  assert.ok(visible.some(freq => Math.abs(freq - 261.625565) < 1));
  assert.ok(nextPeriod.some(freq => Math.abs(freq - 523.25113) < 2));
  assert.notDeepEqual(visible, nextPeriod, 'scrolling changes required frequencies');
  const physical = visible.map(f => findNearestPianoSample(f)?.id).filter(Boolean);
  assert.ok(physical.length > 0, 'all playback frequencies resolve through real piano sample catalog');
});

test('#30 disabled mapped depths do not warm an invisible note; re-enable restores it', () => {
  const layout = {...STANDARD_LAYOUT_256TEST,
    lanes: STANDARD_LAYOUT_256TEST.lanes.map(lane => ({...lane})),
    mapping: [...STANDARD_LAYOUT_256TEST.mapping],
  };
  const tuning = STANDARD_TUNING_12EDO;
  const range = getKeyboardColumnRange(layout, tuning, 0);
  const x = Math.max(0, -range.startColumn);
  const baseX = ((range.startColumn + x) % range.period + range.period) % range.period;
  const laneIndex = baseX * 2;
  layout.lanes[laneIndex].activeDepths = 8;
  const before = getVisiblePianoFrequencies(layout, tuning, range, x, x);
  const mappedDeepAddress = encodeAddress(baseX, false, 7);
  assert.ok(layout.mapping[mappedDeepAddress] >= 0);
  layout.lanes[laneIndex].activeDepths = 1;
  const after = getVisiblePianoFrequencies(layout, tuning, range, x, x);
  assert.ok(after.length < before.length, 'inactive mapped notes must be excluded from warmup');
  layout.lanes[laneIndex].activeDepths = 8;
  assert.deepEqual(getVisiblePianoFrequencies(layout, tuning, range, x, x), before);
  assert.deepEqual(getVisiblePianoFrequencies(layout, tuning, range, 10, 9), []);
});
