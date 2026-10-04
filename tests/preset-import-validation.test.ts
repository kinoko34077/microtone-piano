import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  STANDARD_LAYOUT_12EDO,
  STANDARD_TUNING_12EDO,
} from '../src/core/presets';
import {calculateFrequency, isValidFrequencyValue} from '../src/core/pitch';
import {
  validateLayoutPresetData,
  validatePresetImport,
  validateTuningPresetData,
} from '../src/core/presetValidation';

const clone = <T>(value: T): T => structuredClone(value);

test('current exported layout+tuning package validates atomically', () => {
  const result = validatePresetImport(
    {
      type: 'MultiMicrotonalPackage',
      version: '1.0',
      layoutPreset: clone(STANDARD_LAYOUT_12EDO),
      tuningPreset: clone(STANDARD_TUNING_12EDO),
    },
    STANDARD_TUNING_12EDO,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.kind, 'package');
    assert.equal(result.layout.id, STANDARD_LAYOUT_12EDO.id);
    assert.equal(result.tuning?.id, STANDARD_TUNING_12EDO.id);
  }
});

test('tuning validation rejects malformed and duplicate pitch identity', () => {
  assert.equal(
    validateTuningPresetData({...clone(STANDARD_TUNING_12EDO), pitches: 'broken'}).ok,
    false,
  );

  const duplicate = clone(STANDARD_TUNING_12EDO);
  duplicate.pitches = [duplicate.pitches[0], {...duplicate.pitches[0]}];
  assert.equal(validateTuningPresetData(duplicate).ok, false);
});

test('tuning validation enforces finite type-specific domains including positive explicit frequency', () => {
  const badEdo = clone(STANDARD_TUNING_12EDO);
  badEdo.pitches[0] = {...badEdo.pitches[0], edo: 0};
  assert.equal(validateTuningPresetData(badEdo).ok, false);

  const badRatio = clone(STANDARD_TUNING_12EDO);
  badRatio.pitches[0] = {
    id: 0,
    name: 'bad ratio',
    type: 'ratio',
    numerator: 1,
    denominator: 0,
  };
  assert.equal(validateTuningPresetData(badRatio).ok, false);

  const zeroFrequency = clone(STANDARD_TUNING_12EDO);
  zeroFrequency.pitches[0] = {
    id: 0,
    name: 'zero',
    type: 'frequency',
    frequency: 0,
  };
  assert.equal(validateTuningPresetData(zeroFrequency).ok, false);

  const positiveFrequency = clone(STANDARD_TUNING_12EDO);
  positiveFrequency.pitches[0] = {
    id: 0,
    name: 'positive',
    type: 'frequency',
    frequency: 0.5,
  };
  assert.equal(validateTuningPresetData(positiveFrequency).ok, true);
});

test('zero-Hz frequency is not aliased to base frequency and is rejected before audio startup', async () => {
  const zeroPitch = {
    id: 0,
    name: 'zero',
    type: 'frequency' as const,
    frequency: 0,
  };

  assert.equal(isValidFrequencyValue(0), false);
  assert.equal(isValidFrequencyValue(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidFrequencyValue(0.5), true);
  assert.equal(calculateFrequency(zeroPitch, STANDARD_TUNING_12EDO), 0);

  const audioSource = await readFile(new URL('../src/core/audio.ts', import.meta.url), 'utf8');
  const guardIndex = audioSource.indexOf('if (!isValidFrequencyValue(frequency))');
  const contextIndex = audioSource.indexOf('const ctx = await this.ensureAudioContext()', guardIndex);
  assert.notEqual(guardIndex, -1, 'missing invalid-frequency runtime guard');
  assert.notEqual(contextIndex, -1, 'missing AudioContext startup after runtime guard');
  assert.ok(guardIndex < contextIndex, 'invalid frequency must be rejected before AudioContext startup');
  assert.match(audioSource.slice(guardIndex, contextIndex), /onOutOfRangeCallback/);
  assert.match(audioSource.slice(guardIndex, contextIndex), /0より大きい有限値/);
});

test('layout validation rejects invalid lanes, boundaries, and mapping scalars', () => {
  const badDepth = clone(STANDARD_LAYOUT_12EDO);
  badDepth.lanes[0].activeDepths = 9;
  assert.equal(validateLayoutPresetData(badDepth).ok, false);

  const badBoundary = clone(STANDARD_LAYOUT_12EDO);
  badBoundary.lanes[0] = {activeDepths: 2, customBoundaries: [0, 0.8, 0.4]};
  assert.equal(validateLayoutPresetData(badBoundary).ok, false);

  const badMapping = clone(STANDARD_LAYOUT_12EDO);
  badMapping.mapping[0] = 1.5;
  assert.equal(validateLayoutPresetData(badMapping).ok, false);
});

test('package cross-validation fails before admission when layout cannot resolve under imported tuning', () => {
  const emptyTuning = clone(STANDARD_TUNING_12EDO);
  emptyTuning.pitches = [];
  const result = validatePresetImport(
    {
      layoutPreset: clone(STANDARD_LAYOUT_12EDO),
      tuningPreset: emptyTuning,
    },
    STANDARD_TUNING_12EDO,
  );

  assert.equal(result.ok, false);
});

test('standalone layout validates against the active tuning and legacy integer references stay supported', () => {
  const layout = clone(STANDARD_LAYOUT_12EDO);
  layout.mapping[0] = 999;
  const result = validatePresetImport(layout, STANDARD_TUNING_12EDO);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.kind, 'layout');
  }
});

test('standalone tuning and malformed wrapper are classified deterministically', () => {
  const tuningResult = validatePresetImport(
    clone(STANDARD_TUNING_12EDO),
    STANDARD_TUNING_12EDO,
  );
  assert.equal(tuningResult.ok, true);
  if (tuningResult.ok) {
    assert.equal(tuningResult.kind, 'tuning');
  }

  const malformedWrapper = validatePresetImport(
    {tuningPreset: clone(STANDARD_TUNING_12EDO)},
    STANDARD_TUNING_12EDO,
  );
  assert.equal(malformedWrapper.ok, false);
});
