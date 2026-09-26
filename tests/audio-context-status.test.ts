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

test('AudioEngine exposes starting ready and failed context states around ensureAudioContext', async () => {
  const source = await read('src/core/audio.ts');
  const ensure = section(source, 'public async ensureAudioContext()', 'public setSoundSource');

  assert.match(source, /export type AudioContextStatus/);
  assert.match(source, /setAudioContextStatusCallback/);
  assert.match(ensure, /kind: 'starting'/);
  assert.match(ensure, /kind: 'ready'/);
  assert.match(ensure, /kind: 'failed'/);
  assert.match(ensure, /try \{/);
  assert.match(ensure, /catch \(error\)/);
  assert.match(ensure, /throw error/);
});

test('retryAudioContext reuses the same initialization path', async () => {
  const source = await read('src/core/audio.ts');
  const retry = section(source, 'public async retryAudioContext()', 'public setSoundSource');

  assert.match(retry, /return this\.ensureAudioContext\(\)/);
});

test('App subscribes to AudioContext status and exposes a user-gesture retry control', async () => {
  const source = await read('src/App.tsx');

  assert.match(source, /AudioContextStatus/);
  assert.match(source, /setAudioContextStatusCallback/);
  assert.match(source, /audioContextStatus=\{audioContextStatus\}/);
  assert.match(source, /onRetryAudio=\{handleRetryAudio\}/);
  assert.match(source, /globalAudioEngine\.retryAudioContext\(\)/);
  assert.match(source, /audioContextStatus\.kind === 'failed'/);
  assert.match(source, />再試行</);
  assert.match(source, /音声準備中/);
  assert.match(source, /音声準備済/);
  assert.match(source, /音声エラー/);
});

test('audio status remains compact and live on the performance surface', async () => {
  const source = await read('src/App.tsx');
  const header = section(source, 'const HeaderActions:', ');');

  assert.match(header, /role="status"/);
  assert.match(header, /aria-live="polite"/);
  assert.match(header, /audioContextStatus\.message/);
});
