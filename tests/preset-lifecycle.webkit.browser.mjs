import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { webkit } from 'playwright';

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
    await page.waitForFunction(async () => {
      const id = document.querySelector('#layout-select')?.value;
      if (!id?.startsWith('layout_custom_')) return false;
      const db = await new Promise((ok, fail) => {
        const r = indexedDB.open('MultiMicrotonalKeyboardDB', 1);
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      try {
        const tx = db.transaction(['layoutPresets', 'appSettings'], 'readonly');
        const get = (store, key) => new Promise((ok, fail) => {
          const r = tx.objectStore(store).get(key);
          r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
        });
        const [preset, settings] = await Promise.all([
          get('layoutPresets', id), get('appSettings', 'current_settings')
        ]);
        return Boolean(preset) && settings?.value?.defaultLayoutPresetId === id;
      } finally { db.close(); }
    }, null, { timeout: 20000 });
    const before = await dbState(page);
    console.log('WEBKIT_FRESH_EARLY_STATE', JSON.stringify(before));
    // Settings use a 180ms debounce; independently recheck after it settles
    // before interpreting a mismatched default as a durable state defect.
    await pause(1000);
    const beforeSettled = await dbState(page);
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
    await page.waitForFunction(async (id) => {
      const db = await new Promise((ok, fail) => {
        const r = indexedDB.open('MultiMicrotonalKeyboardDB', 1);
        r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
      });
      try {
        const tx = db.transaction(['layoutPresets', 'appSettings'], 'readonly');
        const get = (store, key) => new Promise((ok, fail) => {
          const r = tx.objectStore(store).get(key);
          r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
        });
        const [preset, settings] = await Promise.all([
          get('layoutPresets', id), get('appSettings', 'current_settings')
        ]);
        return !!preset && settings?.value?.defaultLayoutPresetId === id;
      } finally { db.close(); }
    }, denied.id, { timeout: 20000 });
    const recovered = await dbState(page);
    console.log('WEBKIT_RECOVERY_EARLY_STATE', JSON.stringify(recovered));
    await pause(1000);
    const recoveredSettled = await dbState(page);
    console.log('WEBKIT_RECOVERY_SETTLED_STATE', JSON.stringify(recoveredSettled));
    assert.equal(recoveredSettled.persistedDefault, denied.id);
    assert.equal(recoveredSettled.presetSaved, true);
    await page.reload();
    await openMenu(page);
    await page.waitForFunction(id => document.querySelector('#layout-select')?.value === id,
      denied.id, { timeout: 10000 });
    assert.deepEqual(errors, []);
    await context.close();
    console.log('WEBKIT_DENIED_RECOVERY_PASS', JSON.stringify({ denied, recovered }));
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
