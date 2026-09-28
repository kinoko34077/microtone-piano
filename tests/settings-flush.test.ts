import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DebouncedSettingsSaver} from '../src/core/debouncedSettingsSaver';
import {DEFAULT_APP_SETTINGS, StorageService} from '../src/core/storage';

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

test('saveSettings opens the write transaction synchronously after IndexedDB is ready', async () => {
  const storageService = new StorageService();
  let transactionOpened = 0;
  const stores = new Set<string>();
  const fakeDb = {
    objectStoreNames: {contains: (name: string) => stores.has(name)},
    createObjectStore: (name: string) => {
      stores.add(name);
      return {};
    },
    transaction: () => {
      transactionOpened += 1;
      const transaction: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        error: Error | null;
        objectStore: () => {get: () => {onsuccess: ((event: Event) => void) | null}; put: () => void};
      } = {
        oncomplete: null,
        onerror: null,
        error: null,
        objectStore: () => ({
          get: () => {
            const request: {onsuccess: ((event: Event) => void) | null} = {onsuccess: null};
            queueMicrotask(() => request.onsuccess?.({target: request} as unknown as Event));
            return request;
          },
          put: () => undefined,
        }),
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
  };
  const fakeIndexedDB = {
    open: () => {
      const request: {
        result: typeof fakeDb;
        onupgradeneeded: ((event: Event) => void) | null;
        onsuccess: ((event: Event) => void) | null;
        onerror: (() => void) | null;
        error: Error | null;
      } = {
        result: fakeDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.({target: request} as unknown as Event);
        request.onsuccess?.({target: request} as unknown as Event);
      });
      return request;
    },
  } as unknown as IDBFactory;
  const globalObject = globalThis as typeof globalThis & {indexedDB?: IDBFactory};
  const previousIndexedDB = globalObject.indexedDB;
  Object.defineProperty(globalObject, 'indexedDB', {configurable: true, value: fakeIndexedDB});

  try {
    await storageService.getSettings();
    transactionOpened = 0;

    const savePromise = storageService.saveSettings(DEFAULT_APP_SETTINGS);

    assert.equal(transactionOpened, 1);
    await savePromise;
  } finally {
    if (previousIndexedDB) {
      Object.defineProperty(globalObject, 'indexedDB', {configurable: true, value: previousIndexedDB});
    } else {
      delete (globalObject as {indexedDB?: IDBFactory}).indexedDB;
    }
  }
});

test('App wires pagehide and unmount to flush without flushing on every settings dependency cleanup', async () => {
  const source = (await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

  assert.match(source, /DebouncedSettingsSaver/);
  assert.match(source, /settingsSaver\.schedule\(settings\)/);
  assert.match(source, /window\.addEventListener\('pagehide', flushPendingSettings\)/);
  assert.match(source, /window\.removeEventListener\('pagehide', flushPendingSettings\)/);
  assert.match(source, /settingsSaver\.flush\(\)/);

  const visibilityHandler = section(source, 'const handleVisibilityChange = () => {', '    window.addEventListener');
  assert.match(visibilityHandler, /document\.hidden/);
  assert.match(visibilityHandler, /settingsSaver\.flush\(\)/);

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


test('failed settings writes remain pending and can be retried after rejection', async () => {
  const attempts: Settings[] = [];
  let rejectSave: ((error: Error) => void) | null = null;
  const saver = new DebouncedSettingsSaver<Settings>(
    (settings) => {
      attempts.push(settings);
      return new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      });
    },
    (callback) => {
      callback();
      return 1;
    },
    () => undefined,
    180,
  );

  saver.schedule({value: 10});
  await Promise.resolve();
  assert.deepEqual(attempts, [{value: 10}]);

  rejectSave?.(new Error('temporary write failure'));
  await Promise.resolve();

  saver.flush();
  await Promise.resolve();
  assert.deepEqual(attempts, [{value: 10}, {value: 10}], 'a rejected write must remain retryable');
});

test('settings scheduled while a write is in flight are committed after the first write succeeds', async () => {
  const attempts: Settings[] = [];
  let resolveFirst: (() => void) | null = null;
  const saver = new DebouncedSettingsSaver<Settings>(
    (settings) => {
      attempts.push(settings);
      if (settings.value === 1) {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve();
    },
    (callback) => {
      callback();
      return 1;
    },
    () => undefined,
    180,
  );

  saver.schedule({value: 1});
  await Promise.resolve();
  saver.schedule({value: 2});
  resolveFirst?.();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(attempts, [{value: 1}, {value: 2}]);
});
