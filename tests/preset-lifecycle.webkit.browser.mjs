import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { webkit } from 'playwright';
import {readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';

// #24: Fresh isolated WebKit contexts only. This does NOT test physical iPhone Safari.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startPreview(port) {
  const address = 'http://127.0.0.1:' + port + '/';
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) throw new Error('Preview server exited: ' + server.exitCode);
    try { if ((await fetch(address)).ok) return server; } catch {}
    await pause(200);
  }
  server.kill('SIGTERM');
  throw new Error('WebKit preview unavailable');
}

async function dbState(page) {
  return page.evaluate(async () => {
    const id = document.querySelector('#layout-select')?.value ?? null;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('MultiMicrotonalKeyboardDB', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['layoutPresets', 'appSettings'], 'readonly');
      const get = (store, key) => new Promise((resolve, reject) => {
        const request = tx.objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [preset, settings] = await Promise.all([
        get('layoutPresets', id), get('appSettings', 'current_settings')
      ]);
      return { id, presetSaved: Boolean(preset),
        persistedDefault: settings?.value?.defaultLayoutPresetId ?? null };
    } finally { db.close(); }
  });
}

// Poll actual completed transactions from Node, not an async Promise returned
// to WebKit's waitForFunction (which may be treated as a truthy handle).
async function waitForDurableState(page, id) {
  const deadline = Date.now() + 20000;
  let last = null;
  while (Date.now() < deadline) {
    last = await dbState(page);
    if (last.id === id && last.presetSaved && last.persistedDefault === id) {
      await pause(350);
      const repeated = await dbState(page);
      if (repeated.id === id && repeated.presetSaved && repeated.persistedDefault === id)
        return repeated;
    }
    await pause(120);
  }
  throw new Error('Preset/settings durable state did not converge: ' + JSON.stringify(last));
}

async function openMenu(page) {
  await page.locator('button[aria-label="メニューを開く"]').click();
  await page.locator('button[aria-label="鍵盤配置を複製"]').waitFor();
}

test('#24 WebKit: fresh preset save is durable after reload in an isolated profile', { timeout: 150000 }, async () => {
  const port = 8795;
  const address = 'http://127.0.0.1:' + port + '/';
  const server = await startPreview(port);
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(address);
    await openMenu(page);
    await page.locator('button[aria-label="鍵盤配置を複製"]').click();
    await page.waitForFunction(() => document.querySelector('#layout-select')
      ?.value?.startsWith('layout_custom_'));
    const before = await dbState(page);
    console.log('WEBKIT_FRESH_EARLY_STATE', JSON.stringify(before));
    const beforeSettled = await waitForDurableState(page, before.id);
    console.log('WEBKIT_FRESH_SETTLED_STATE', JSON.stringify(beforeSettled));
    assert.equal(beforeSettled.presetSaved, true);
    assert.equal(beforeSettled.persistedDefault, beforeSettled.id);
    await page.reload();
    await openMenu(page);
    await page.waitForFunction((id) => document.querySelector('#layout-select')?.value === id,
      before.id, { timeout: 10000 });
    const after = await dbState(page);
    assert.deepEqual(after, beforeSettled);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('WEBKIT_FRESH_SAVE_RELOAD_PASS', JSON.stringify(after));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});

test('#24 WebKit: refused IndexedDB write preserves draft and retries without false saved ID', { timeout: 150000 }, async () => {
  const port = 8796;
  const address = 'http://127.0.0.1:' + port + '/';
  const server = await startPreview(port);
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const original = IDBObjectStore.prototype.put;
      window.__restorePresetPut = () => { IDBObjectStore.prototype.put = original; };
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'layoutPresets' || this.name === 'tuningPresets')
          throw new DOMException('WebKit test quota', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    await page.goto(address);
    await openMenu(page);
    await page.locator('button[aria-label="鍵盤配置を複製"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')]
      .some((element) => element.textContent.includes('プリセット')));
    const denied = await dbState(page);
    assert.ok(denied.id.startsWith('layout_custom_'));
    assert.equal(denied.presetSaved, false);
    assert.notEqual(denied.persistedDefault, denied.id,
      'An uncommitted preset must not become the persisted default');

    await page.evaluate(() => window.__restorePresetPut());
    await page.getByRole('button', { name: '保存を再試行' }).click();
    const recovered = await dbState(page);
    console.log('WEBKIT_RECOVERY_EARLY_STATE', JSON.stringify(recovered));
    const recoveredSettled = await waitForDurableState(page, denied.id);
    console.log('WEBKIT_RECOVERY_SETTLED_STATE', JSON.stringify(recoveredSettled));
    assert.equal(recoveredSettled.persistedDefault, denied.id);
    assert.equal(recoveredSettled.presetSaved, true);
    await page.reload();
    await openMenu(page);
    await page.waitForFunction(id => document.querySelector('#layout-select')?.value === id,
      denied.id, { timeout: 10000 });
    assert.deepEqual(errors, []);
    await context.close();
    console.log('WEBKIT_DENIED_RECOVERY_PASS', JSON.stringify({ denied, recovered: recoveredSettled }));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});

test('#24 WebKit: same invalid file may be selected twice without changing presets', { timeout: 150000 }, async () => {
  const port = 8797;
  const address = 'http://127.0.0.1:' + port + '/';
  const server = await startPreview(port);
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    let dialogs = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss(); });
    await page.goto(address);
    await openMenu(page);
    const input = page.locator('input[type="file"][accept=".json,.bin"]');
    const file = { name: 'invalid-preset.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 999, notAPreset: true })) };
    for (let number = 1; number <= 2; number++) {
      await input.setInputFiles(file);
      for (let attempts = 0; attempts < 70 && dialogs < number; attempts++) await pause(50);
      assert.equal(dialogs, number, 'Each selection should produce a separate rejection dialog');
      const cleared = await input.evaluate((el) => ({ value: el.value, count: el.files.length }));
      assert.deepEqual(cleared, { value: '', count: 0 });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log('WEBKIT_INVALID_RESELECT_PASS', dialogs);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});


test('#34 Linux WebKit: real compressed BIN download and imported preset roundtrip', {timeout: 150000}, async () => {
  const port = 8798;
  const server = await startPreview(port);
  let browser;
  try {
    browser = await webkit.launch({headless: true});
    const context = await browser.newContext({
      viewport: {width: 390, height: 844},
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => {dialogs.push(dialog.message()); await dialog.dismiss();});
    await page.goto('http://127.0.0.1:' + port + '/');
    await openMenu(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', {timeout: 25000}),
      page.getByRole('button', {name: 'BIN', exact: true}).click(),
    ]);
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 4).toString(), 'MMPK');
    assert.equal(bytes[4], 1);
    const data = JSON.parse(gunzipSync(bytes.subarray(12)).toString('utf8'));
    assert.equal(data.type, 'MultiMicrotonalPackage');
    assert.equal(data.layoutPreset.mapping.length, 256);
    const changed = structuredClone(data);
    changed.layoutPreset.name = 'WebKit gzip imported layout';
    changed.tuningPreset.name = 'WebKit gzip imported tuning';
    const raw = Buffer.from(JSON.stringify(changed), 'utf8');
    const header = Buffer.alloc(12);
    header.write('MMPK', 0, 'ascii');
    header[4] = 1;
    header[5] = 1;
    header.writeUInt32LE(raw.length, 8);
    await page.locator('input[type="file"][accept=".json,.bin"]').setInputFiles({
      name: 'webkit-roundtrip.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([header, gzipSync(raw)]),
    });
    await page.waitForFunction(() => document.querySelector('input[type="file"]')?.files.length === 0);

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download', {timeout: 25000}),
      page.getByRole('button', {name: 'JSON', exact: true}).click(),
    ]);
    const imported = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'));
    assert.equal(imported.layoutPreset.name, changed.layoutPreset.name);
    assert.equal(imported.tuningPreset.name, changed.tuningPreset.name);
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    console.log('WEBKIT_GZIP_BIN_ROUNDTRIP_PASS', JSON.stringify({binBytes: bytes.length}));
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});


test('#37 Linux WebKit: imported JSON package registers both presets and survives reload', {timeout: 150000}, async () => {
  const port = 8801;
  const server = await startPreview(port);
  let browser;
  try {
    browser = await webkit.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 390, height: 844}, acceptDownloads: true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + port + '/');
    await openMenu(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', {timeout: 25000}),
      page.getByRole('button', {name: 'JSON', exact: true}).click(),
    ]);
    const pkg = JSON.parse(await readFile(await download.path(), 'utf8'));
    pkg.layoutPreset.name = '#37 WebKit レイアウト';
    pkg.tuningPreset.name = '#37 WebKit チューニング';
    const input = page.locator('input[type="file"][accept=".json,.bin"]');
    await input.setInputFiles({
      name: 'webkit-import.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(pkg)),
    });
    await page.waitForFunction(() => document.querySelector('#layout-select')
      ?.value?.startsWith('layout_custom_import_'));
    const layoutId = await page.locator('#layout-select').inputValue();
    const tuningId = await page.locator('#tuning-select').inputValue();
    assert.ok(tuningId.startsWith('tuning_custom_import_'));
    const durable = await waitForDurableState(page, layoutId);
    assert.equal(durable.presetSaved, true);
    const importedTuning = await page.evaluate(async id => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('MultiMicrotonalKeyboardDB', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const req = db.transaction('tuningPresets', 'readonly').objectStore('tuningPresets').get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } finally { db.close(); }
    }, tuningId);
    assert.equal(importedTuning?.name, pkg.tuningPreset.name);
    await page.reload();
    await openMenu(page);
    await page.waitForFunction(id => document.querySelector('#layout-select')?.value === id,
      layoutId);
    assert.equal(await page.locator('#tuning-select').inputValue(), tuningId);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});
