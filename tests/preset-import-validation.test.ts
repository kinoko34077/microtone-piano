import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  STANDARD_LAYOUT_12EDO,
  STANDARD_LAYOUT_256TEST,
  STANDARD_TUNING_12EDO,
  STANDARD_TUNING_256TEST,
} from '../src/core/presets';
import {calculateFrequency, encodePitchReference, isValidFrequencyValue} from '../src/core/pitch';
import {encodeCompressedPreset, decodePresetBytes, MAX_JSON_PRESET_BYTES} from '../src/core/binaryPackage';
import {StorageService} from '../src/core/storage';
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


test('#21 invalid import retains previous presets and always clears the file selection in finally', async () => {
  const source = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const handleFileImport = async');
  const end = source.indexOf('\n  return (', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /if \('error' in admission\)\s*\{[\s\S]*?return;/);
  assert.match(handler, /\} finally \{[\s\S]*?fileInputRef\.current\.value = ''/);
  assert.ok(handler.indexOf('} finally {') > handler.indexOf('} catch (error: unknown)'));
});


test('#34 new gzip BIN has versioned header and preserves 256-slot/255-pitch package exactly', async () => {
  const layout = clone(STANDARD_LAYOUT_256TEST);
  const tuning = clone(STANDARD_TUNING_256TEST);
  layout.mapping[0] = -1; // original unassigned sentinel
  layout.mapping[1] = encodePitchReference(1, -3);
  layout.mapping[2] = encodePitchReference(254, 5);
  tuning.pitches[0] = {id: 0, name: '試験周波数', type: 'frequency', frequency: 0.00000123456789};
  tuning.pitches[1] = {id: 1, name: '比率', type: 'ratio', numerator: 1000003, denominator: 1000009};
  const packageData = {
    type: 'MultiMicrotonalPackage',
    version: '1.0',
    timestamp: '2026-11-09T00:00:00.000Z',
    layoutPreset: layout,
    tuningPreset: tuning,
  };
  const compressed = await encodeCompressedPreset(packageData);
  assert.equal(new TextDecoder().decode(compressed.subarray(0, 4)), 'MMPK');
  assert.equal(compressed[4], 1);
  assert.equal(compressed[5], 1);
  assert.equal(compressed[6], 0);
  assert.equal(compressed[7], 0);
  assert.equal(new DataView(compressed.buffer).getUint32(8, true), new TextEncoder().encode(JSON.stringify(packageData)).length);
  assert.ok(compressed.byteLength < new TextEncoder().encode(JSON.stringify(packageData)).byteLength, 'this representative 256-slot package should compress');
  const decoded = await decodePresetBytes(compressed);
  assert.deepEqual(decoded, packageData);
  assert.equal(validatePresetImport(decoded, tuning).ok, true);
});

test('#34 old UTF-8 JSON BIN, readable JSON, standalone presets and new BIN share validation', async () => {
  const layout = clone(STANDARD_LAYOUT_12EDO);
  const tuning = clone(STANDARD_TUNING_12EDO);
  for (const original of [
    layout,
    tuning,
    {type: 'MultiMicrotonalPackage', version: '1.0', layoutPreset: layout, tuningPreset: tuning},
  ]) {
    const legacyBytes = new TextEncoder().encode(JSON.stringify(original));
    const legacyParsed = await decodePresetBytes(legacyBytes);
    assert.deepEqual(legacyParsed, original);
    assert.equal(validatePresetImport(legacyParsed, tuning).ok, true);
    const modernParsed = await decodePresetBytes(await encodeCompressedPreset(original));
    assert.deepEqual(modernParsed, original);
    assert.equal(validatePresetImport(modernParsed, tuning).ok, true);
  }
});

test('#34 StorageService imports new BIN and legacy .bin without using file extension for decoding', async () => {
  const layout = clone(STANDARD_LAYOUT_12EDO);
  const binary = await encodeCompressedPreset(layout);
  const service = new StorageService();
  const asFile = (bytes: Uint8Array, name: string): File => {
    const blob = new Blob([bytes]);
    return {name, size: blob.size, arrayBuffer: () => blob.arrayBuffer()} as File;
  };
  assert.deepEqual(await service.importFromFile(asFile(binary, 'unexpected.json')), layout);
  assert.deepEqual(await service.importFromFile(asFile(new TextEncoder().encode(JSON.stringify(layout)), 'legacy.bin')), layout);
});

test('#34 reject malformed or future MMPK headers, corrupt gzip, declared size drift and invalid JSON', async () => {
  const valid = await encodeCompressedPreset({type: 'MultiMicrotonalPackage', version: '1.0', layoutPreset: clone(STANDARD_LAYOUT_12EDO)});
  const withChange = (mutate: (bytes: Uint8Array) => void) => {
    const changed = valid.slice();
    mutate(changed);
    return changed;
  };
  await assert.rejects(decodePresetBytes(valid.slice(0, 6)), /ヘッダー/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => { bytes[4] = 2; })), /ヘッダー/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => { bytes[5] = 99; })), /ヘッダー/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => { bytes[7] = 1; })), /ヘッダー/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => {
    new DataView(bytes.buffer).setUint32(8, MAX_JSON_PRESET_BYTES + 1, true);
  })), /64MiB/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => {
    new DataView(bytes.buffer).setUint32(8, 1, true);
  })), /サイズ/);
  await assert.rejects(decodePresetBytes(withChange((bytes) => {
    bytes[bytes.length - 1] ^= 0xff;
  })), /gzip|破損|展開/);
  await assert.rejects(decodePresetBytes(new TextEncoder().encode('{bad json')), /SyntaxError|JSON|property name/i);
});

test('#34 all available codec paths retain editor errors and same-file retry in Sidebar', async () => {
  const source = await readFile(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(source, /await storageService\.exportAsBinaryPackage/);
  assert.match(source, /BINの書き出しに失敗しました/);
  assert.match(source, /validatePresetImport\(data, currentTuning\)/);
  assert.match(source, /fileInputRef\.current\.value = ''/);
});
