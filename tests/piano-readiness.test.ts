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

test('uncached keys use the actual piano sample, never an oscillator fallback', async () => {
  const audio = await read('src/core/audio.ts');
  const piano = section(audio, 'private async createPianoSources(', 'private lastPianoSampleStatus:');
  assert.match(piano, /kind: 'loading'/);
  assert.match(piano, /await this\.loadPianoSampleBuffer\(sample\)/);
  assert.match(piano, /source\.buffer = buffer/);
  assert.match(piano, /source\.start\(startAt\)/);
  assert.doesNotMatch(piano, /createOscillator\(/);
});

test('released inputs are cancelled before late sample playback', async () => {
  const audio = await read('src/core/audio.ts');
  const on = section(audio, 'public async noteOn(', 'public noteOff(');
  const off = section(audio, 'public noteOff(', 'public getActiveVoices()');
  const piano = section(audio, 'private async createPianoSources(', 'private lastPianoSampleStatus:');
  assert.match(on, /this\.pendingVoices\.set\(voiceId, pending\)/);
  assert.match(on, /void \(async \(\) => \{/);
  assert.match(on, /return voiceId;/);
  assert.match(off, /pending\.cancelled = true/);
  assert.match(piano, /if \(isCancelled\(\)\) return null/);
  assert.ok(
    piano.indexOf('if (isCancelled()) return null') < piano.indexOf('source.start(startAt)'),
    'released notes must not start after sample decoding',
  );
});

test('pending cancellation survives async decode until source registration', async () => {
  const audio = await read('src/core/audio.ts');
  const on = section(audio, 'public async noteOn(', 'public noteOff(');
  assert.match(on, /if \(pending\.cancelled \|\| epoch !== this\.voiceEpoch/);
  assert.match(on, /source\.stop\(ctx\.currentTime\)/);
  assert.match(on, /oscillator\.stop\(ctx\.currentTime\)/);
  assert.ok(
    on.indexOf('this.activeVoices.set(voiceId, voiceNode)') <
    on.lastIndexOf('this.pendingVoices.delete(voiceId)'),
    'pending tokens should survive through registration',
  );
});

test('sample attack and decay use playback readiness time', async () => {
  const audio = await read('src/core/audio.ts');
  const on = section(audio, 'public async noteOn(', 'public noteOff(');
  assert.match(on, /const playbackStart = Math\.max\(now, ctx\.currentTime\)/);
  assert.match(on, /linearRampToValueAtTime\(velocityGain, playbackStart \+ attackTime\)/);
  assert.match(on, /const decayEndTime = playbackStart \+ attackTime/);
});

test('visible samples prewarm before slow offscreen fetching and yield to live notes', async () => {
  const audio = await read('src/core/audio.ts');
  const preload = section(audio, 'private async runPianoSamplePreload(', 'private stopVoiceNode(');
  assert.match(preload, /visiblePianoSampleIds/);
  assert.match(preload, /loadPianoSampleBuffer/);
  assert.match(preload, /fetchEncodedPianoSample/);
  assert.match(preload, /LOW_PRIORITY_FETCH_PAUSE_MS/);
  assert.match(preload, /this\.activeVoices\.size > 0 \|\| this\.pendingVoiceCount > 0/);
  assert.match(preload, /this\.preloadNeedsResume = true/);
  assert.match(audio, /MAX_DECODED_PIANO_BYTES/);
  assert.match(audio, /this\.sampleBufferCache\.delete\(sample.id\)/);
  assert.match(audio, /private createAudioContextWithoutResume\(\)/);
});

test('successful piano playback clears readiness warnings', async () => {
  const audio = await read('src/core/audio.ts');
  const piano = section(audio, 'private async createPianoSources(', 'private lastPianoSampleStatus:');
  assert.match(piano, /this\.emitPianoSampleStatus\(null\)/);
  assert.ok(
    piano.lastIndexOf('this.emitPianoSampleStatus(null)') < piano.indexOf('source.start(startAt)'),
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
