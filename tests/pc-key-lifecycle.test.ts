import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PcKeyPressRegistry} from '../src/core/pcKeyPressRegistry';

test('keyup during delayed noteOn cancels the pending press and stops the late voice', () => {
  const stopped: string[] = [];
  const registry = new PcKeyPressRegistry((voiceId) => stopped.push(voiceId));

  const press = registry.begin('a', 42);
  assert.equal(registry.has('a'), true);

  registry.release('a');
  assert.equal(registry.has('a'), true, 'pending press remains tracked until noteOn resolves');

  const accepted = registry.resolve('a', press.token, 'voice-late');

  assert.equal(accepted, false);
  assert.deepEqual(stopped, ['voice-late']);
  assert.equal(registry.has('a'), false);
  assert.equal(registry.getActive('a'), undefined);
});

test('resolved press stays active until keyup, then noteOff runs exactly once', () => {
  const stopped: string[] = [];
  const registry = new PcKeyPressRegistry((voiceId) => stopped.push(voiceId));

  const press = registry.begin('s', 43);
  assert.equal(registry.resolve('s', press.token, 'voice-active'), true);
  assert.deepEqual(registry.getActive('s'), {voiceId: 'voice-active', address: 43});

  registry.release('s');
  registry.release('s');

  assert.deepEqual(stopped, ['voice-active']);
  assert.equal(registry.has('s'), false);
});

test('cancelAll marks pending presses cancelled and stops active voices', () => {
  const stopped: string[] = [];
  const registry = new PcKeyPressRegistry((voiceId) => stopped.push(voiceId));

  const pending = registry.begin('d', 44);
  const active = registry.begin('f', 45);
  assert.equal(registry.resolve('f', active.token, 'voice-f'), true);

  registry.cancelAll();
  assert.deepEqual(stopped, ['voice-f']);
  assert.equal(registry.has('f'), false);
  assert.equal(registry.has('d'), true, 'pending press remains tracked until its promise resolves');

  assert.equal(registry.resolve('d', pending.token, 'voice-d-late'), false);
  assert.deepEqual(stopped, ['voice-f', 'voice-d-late']);
  assert.equal(registry.has('d'), false);
});

test('abort removes only the matching failed startup attempt', () => {
  const stopped: string[] = [];
  const registry = new PcKeyPressRegistry((voiceId) => stopped.push(voiceId));

  const oldAttempt = registry.begin('g', 46);
  const currentAttempt = registry.begin('g', 47);

  registry.abort('g', oldAttempt.token);
  assert.equal(registry.has('g'), true, 'stale failure must not clear a newer key press');

  registry.abort('g', currentAttempt.token);
  assert.equal(registry.has('g'), false);
  assert.deepEqual(stopped, []);
});

test('App registers PC presses before noteOn and routes release/cancel through the registry', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const downStart = source.indexOf('const handleKeyDown = async');
  const upStart = source.indexOf('const handleKeyUp =', downStart);
  assert.notEqual(downStart, -1);
  assert.notEqual(upStart, -1);
  const keyDown = source.slice(downStart, upStart);
  const keyUp = source.slice(upStart, source.indexOf('const handleWindowBlur', upStart));

  assert.match(source, /new PcKeyPressRegistry/);
  assert.match(keyDown, /const press = pcKeyRegistry\.begin\(event\.key, address\);/);
  assert.ok(
    keyDown.indexOf('pcKeyRegistry.begin(event.key, address)') < keyDown.indexOf('await globalAudioEngine.noteOn'),
    'pending key must be registered before async noteOn starts',
  );
  assert.match(keyDown, /pcKeyRegistry\.resolve\(event\.key, press\.token, voiceId\)/);
  assert.match(keyDown, /pcKeyRegistry\.abort\(event\.key, press\.token\)/);
  assert.match(keyUp, /pcKeyRegistry\.release\(event\.key\)/);
  assert.match(source, /pcKeyRegistry\.cancelAll\(\)/);
});
