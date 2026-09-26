import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DebouncedSettingsSaver} from '../src/core/debouncedSettingsSaver';

type Settings = {value: number};

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('schedule keeps only the latest settings and saves after the debounce fires', async () => {
  const saved: Settings[] = [];
  let scheduled: (() => void) | null = null;
  let clearCount = 0;
  const saver = new DebouncedSettingsSaver<Settings>(
    (settings) => {
      saved.push(settings);
      return Promise.resolve();
    },
    (callback) => {
      scheduled = callback;
      return 1;
    },
    () => {
      clearCount += 1;
    },
    180,
  );

  saver.schedule({value: 1});
  saver.schedule({value: 2});

  assert.equal(clearCount, 1);
  assert.deepEqual(saved, []);
  assert.ok(scheduled);
  scheduled?.();
  await Promise.resolve();
  assert.deepEqual(saved, [{value: 2}]);
});

test('flush cancels the timer and immediately starts saving the latest pending settings exactly once', async () => {
  const saved: Settings[] = [];
  let scheduled: (() => void) | null = null;
  let clearCount = 0;
  const saver = new DebouncedSettingsSaver<Settings>(
    (settings) => {
      saved.push(settings);
      return Promise.resolve();
    },
    (callback) => {
      scheduled = callback;
      return 9;
    },
    () => {
      clearCount += 1;
    },
    180,
  );

  saver.schedule({value: 7});
  saver.flush();
  saver.flush();
  await Promise.resolve();

  assert.equal(clearCount, 1);
  assert.deepEqual(saved, [{value: 7}]);

  scheduled?.();
  await Promise.resolve();
  assert.deepEqual(saved, [{value: 7}], 'cancelled debounce callback must not save a second time');
});

test('App wires pagehide and unmount to flush without flushing on every settings dependency cleanup', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(source, /DebouncedSettingsSaver/);
  assert.match(source, /settingsSaver\.schedule\(settings\)/);
  assert.match(source, /window\.addEventListener\('pagehide', flushPendingSettings\)/);
  assert.match(source, /window\.removeEventListener\('pagehide', flushPendingSettings\)/);
  assert.match(source, /settingsSaver\.flush\(\)/);

  const debounceEffect = section(
    source,
    'useEffect(() => {\n    if (!settingsReady)',
    '}, [settings, settingsReady, settingsSaver]);',
  );
  assert.match(debounceEffect, /settingsSaver\.schedule\(settings\)/);
  assert.doesNotMatch(
    debounceEffect,
    /settingsSaver\.flush\(\)/,
    'settings dependency cleanup must not flush every intermediate value and defeat debounce',
  );
});
