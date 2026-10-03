import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  getRuntimeAudioContextState,
  resumeAudioContextForPlayback,
  RuntimeAudioContextState,
} from '../src/core/audioContextLifecycle';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function fakeContext(
  initialState: RuntimeAudioContextState,
  onResume: (setState: (state: RuntimeAudioContextState) => void) => Promise<void>,
) {
  let state = initialState;
  let resumeCalls = 0;
  const context = {
    get state() {
      return state;
    },
    async resume() {
      resumeCalls += 1;
      await onResume((nextState) => {
        state = nextState;
      });
    },
  } as unknown as AudioContext;

  return {
    context,
    get resumeCalls() {
      return resumeCalls;
    },
  };
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

test('interrupted AudioContext is resumed instead of rejected before playback', async () => {
  const fake = fakeContext('interrupted', async (setState) => {
    setState('running');
  });

  const state = await resumeAudioContextForPlayback(fake.context);

  assert.equal(fake.resumeCalls, 1);
  assert.equal(state, 'running');
  assert.equal(getRuntimeAudioContextState(fake.context), 'running');
});

test('suspended AudioContext remains resumable', async () => {
  const fake = fakeContext('suspended', async (setState) => {
    setState('running');
  });

  const state = await resumeAudioContextForPlayback(fake.context);

  assert.equal(fake.resumeCalls, 1);
  assert.equal(state, 'running');
});

test('already-running AudioContext does not call resume', async () => {
  const fake = fakeContext('running', async () => {
    throw new Error('resume should not be called');
  });

  const state = await resumeAudioContextForPlayback(fake.context);

  assert.equal(fake.resumeCalls, 0);
  assert.equal(state, 'running');
});

test('resume rejection remains observable to the caller', async () => {
  const fake = fakeContext('suspended', async () => {
    throw new Error('resume blocked');
  });

  await assert.rejects(resumeAudioContextForPlayback(fake.context), /resume blocked/);
  assert.equal(fake.resumeCalls, 1);
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
