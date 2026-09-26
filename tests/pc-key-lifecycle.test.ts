import test from 'node:test';
import assert from 'node:assert/strict';
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
