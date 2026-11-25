import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

test('activation deletes only obsolete keyboard caches on the shared origin', async () => {
  const keys = new Set(['mmwk-v0', 'mmwk-v1', 'mmwk-legacy', 'gabor-pattern-puzzle-v2', 'mu-chordbot-v1', 'wafu-clock-compat-v2', 'kinotch-hub-preview-v2', 'other-app']);
  const handlers = new Map();
  let claimed = false;
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      clients: {claim: async () => { claimed = true; }},
    },
    caches: {keys: async () => [...keys], delete: async (key) => keys.delete(key)},
  });
  let completion;
  handlers.get('activate')({waitUntil: (promise) => { completion = promise; }});
  await completion;
  assert.equal(claimed, true);
  assert.deepEqual([...keys], ['mmwk-v1', 'gabor-pattern-puzzle-v2', 'mu-chordbot-v1', 'wafu-clock-compat-v2', 'kinotch-hub-preview-v2', 'other-app']);
});
