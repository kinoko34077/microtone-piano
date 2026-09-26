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

test('bounded performance-header component subscribes to status and retries from a user gesture', async () => {
  const [octaveBar, component] = await Promise.all([
    read('src/components/Keyboard/OctaveBar.tsx'),
    read('src/components/AudioContextStatusBadge.tsx'),
  ]);

  assert.match(octaveBar, /actions && \([\s\S]*?<AudioContextStatusBadge \/>/);
  assert.match(component, /AudioContextStatus/);
  assert.match(component, /setAudioContextStatusCallback/);
  assert.match(component, /globalAudioEngine\.retryAudioContext\(\)/);
  assert.match(component, /status\.kind === 'failed'/);
  assert.match(component, />\s*再試行\s*</);
  assert.match(component, /音声準備中/);
  assert.match(component, /音声準備済/);
  assert.match(component, /音声エラー/);
});

test('audio status remains compact and live on the performance surface', async () => {
  const component = await read('src/components/AudioContextStatusBadge.tsx');

  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /status\.message/);
});
