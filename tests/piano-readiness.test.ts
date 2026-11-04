import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('uncached piano starts fallback immediately while warming sample asynchronously', async () => {
  const source = await read('src/core/audio.ts');
  const piano = section(source, 'private async createPianoSources(', 'private async runPianoSamplePreload');

  assert.match(source, /export type PianoSampleStatus/);
  assert.match(source, /setPianoSampleStatusCallback/);
  assert.match(piano, /kind: 'loading'/);
  assert.match(piano, /void this\.loadPianoSampleBuffer\(sample\)\.catch/);
  assert.match(piano, /const fallback = ctx\.createOscillator\(\)/);
  assert.match(piano, /fallback\.start\(now\)/);
  assert.match(piano, /return \{oscillators: \[fallback\], sourceNodes: \[\]\}/);
  assert.doesNotMatch(piano, /await this\.loadPianoSampleBuffer\(sample\)/);
});

test('failed sample preparation reports error without delaying the initial fallback voice', async () => {
  const source = await read('src/core/audio.ts');
  const piano = section(source, 'private async createPianoSources(', 'private async runPianoSamplePreload');

  assert.match(piano, /kind: 'error'/);
  assert.match(piano, /kind: 'loading'/);
  assert.match(piano, /catch\(\(\) =>/);
  assert.doesNotMatch(piano, /elapsed > MAX_PIANO_START_LATENCY_SECONDS/);
});

test('successful piano start clears stale readiness warnings', async () => {
  const source = await read('src/core/audio.ts');
  const piano = section(source, 'private async createPianoSources(', 'private async runPianoSamplePreload');

  assert.match(piano, /this\.emitPianoSampleStatus\(null\)/);
  assert.ok(
    piano.lastIndexOf('this.emitPianoSampleStatus(null)') < piano.indexOf('source.start(startAt)'),
    'status should clear when the current sample is ready to start',
  );
});

test('performance surface exposes piano readiness status through an aria-live header indicator', async () => {
  const source = await read('src/App.tsx');

  assert.match(source, /PianoSampleStatus/);
  assert.match(source, /setPianoSampleStatusCallback/);
  assert.match(source, /pianoSampleStatus=\{pianoSampleStatus\}/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /音源準備中/);
  assert.match(source, /音源遅延/);
  assert.match(source, /音源エラー/);
});
