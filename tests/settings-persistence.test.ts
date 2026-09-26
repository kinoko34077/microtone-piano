import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('storage exposes a synchronous exit snapshot and restores it through IndexedDB', async () => {
  const source = await read('src/core/storage.ts');

  assert.match(source, /SETTINGS_EXIT_SNAPSHOT_KEY/);
  assert.match(source, /saveSettingsExitSnapshot\(settings: AppSettings\): void/);
  assert.match(source, /localStorage\.setItem\(SETTINGS_EXIT_SNAPSHOT_KEY/);
  assert.match(source, /localStorage\.getItem\(SETTINGS_EXIT_SNAPSHOT_KEY\)/);
  assert.match(source, /localStorage\.removeItem\(SETTINGS_EXIT_SNAPSHOT_KEY\)/);
  assert.match(source, /await this\.saveSettings\(exitSnapshot\)/);
});

test('App keeps the latest settings in a ref and snapshots pending state on pagehide', async () => {
  const source = await read('src/App.tsx');

  assert.match(source, /latestSettingsRef/);
  assert.match(source, /latestSettingsRef\.current = settings/);
  assert.match(source, /addEventListener\('pagehide'/);
  assert.match(source, /saveSettingsExitSnapshot\(latestSettingsRef\.current\)/);
  assert.match(source, /removeEventListener\('pagehide'/);
});

test('normal interaction keeps the existing 180 ms IndexedDB debounce', async () => {
  const source = await read('src/App.tsx');

  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /storageService\.saveSettings\(settings\)/);
  assert.match(source, /}, 180\)/);
});
