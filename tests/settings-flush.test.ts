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
  assert.match(source, /settingsSaver\.flushForLifecycle\(\)/);

  const visibilityHandler = section(source, 'const handleVisibilityChange = () => {', '    window.addEventListener');
  assert.match(visibilityHandler, /document\.hidden/);
  assert.match(visibilityHandler, /settingsSaver\.flushForLifecycle\(\)/);

  const debounceEffect = section(
    source,
    'useEffect(() => {\n    if (!settingsReady)',
    '}, [settings, settingsReady, settingsSaver]);',
  );
  assert.match(debounceEffect, /settingsSaver\.schedule\(settings\)/);
  assert.doesNotMatch(
    debounceEffect,
    /settingsSaver\.flush(?:ForLifecycle)?\(\)/,
    'settings dependency cleanup must not flush every intermediate value and defeat debounce',
  );
});


test('settings load distinguishes authoritative absence from read failure', async () => {
  const install = (outcome: 'absent' | 'error') => {
    const fakeDb = {
      objectStoreNames: {contains: () => true},
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const request: any = {result: undefined, error: null, onsuccess: null, onerror: null};
            queueMicrotask(() => {
              if (outcome === 'error') {
                request.error = new Error('temporary read failure');
                request.onerror?.();
              } else {
                request.onsuccess?.();
              }
            });
            return request;
          },
        }),
      }),
    } as unknown as IDBDatabase;
    return {
      open: () => {
        const request: any = {result: fakeDb, error: null, onsuccess: null, onerror: null, onupgradeneeded: null};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory;
  };
  const globalObject = globalThis as typeof globalThis & {indexedDB?: IDBFactory};
  const previousIndexedDB = globalObject.indexedDB;
  try {
    Object.defineProperty(globalObject, 'indexedDB', {configurable: true, value: install('absent')});
    const absent = await new StorageService().loadSettings();
    assert.equal(absent.status, 'absent');
    assert.deepEqual(absent.settings, DEFAULT_APP_SETTINGS);

    Object.defineProperty(globalObject, 'indexedDB', {configurable: true, value: install('error')});
    const failed = await new StorageService().loadSettings();
    assert.equal(failed.status, 'read_failed');
    assert.deepEqual(failed.settings, DEFAULT_APP_SETTINGS);
    assert.match(String(failed.error), /temporary read failure/);
  } finally {
    if (previousIndexedDB) Object.defineProperty(globalObject, 'indexedDB', {configurable: true, value: previousIndexedDB});
    else delete (globalObject as {indexedDB?: IDBFactory}).indexedDB;
  }
});

test('rejected save stays pending and flush retries the same latest value', async () => {
  const attempts: Settings[] = [];
  let scheduled: (() => void) | null = null;
  let fail = true;
  const saver = new DebouncedSettingsSaver<Settings>(
    async (value) => {
      attempts.push(value);
      if (fail) {
        fail = false;
        throw new Error('write failed');
      }
    },
    (callback) => ((scheduled = callback), 1),
    () => {},
    180,
  );
  saver.schedule({value: 7});
  scheduled?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saver.hasPending(), true);

  saver.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(attempts, [{value: 7}, {value: 7}]);
  assert.equal(saver.hasPending(), false);
});

test('newer settings scheduled during an in-flight save become the eventual durable target', async () => {
  const attempts: Settings[] = [];
  const resolvers: Array<() => void> = [];
  let scheduled: (() => void) | null = null;
  const saver = new DebouncedSettingsSaver<Settings>(
    (value) => {
      attempts.push(value);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    (callback) => ((scheduled = callback), 1),
    () => {},
    180,
  );

  saver.schedule({value: 1});
  scheduled?.();
  await Promise.resolve();
  saver.schedule({value: 2});
  saver.flush();
  assert.deepEqual(attempts, [{value: 1}]);

  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(attempts, [{value: 1}, {value: 2}]);
  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saver.hasPending(), false);
});

test('lifecycle flush starts the latest revision before an older save settles and fences stale completion', async () => {
  const attempts: Settings[] = [];
  const resolvers: Array<() => void> = [];
  let scheduled: (() => void) | null = null;
  let savedSignals = 0;
  const saver = new DebouncedSettingsSaver<Settings>(
    (value) => {
      attempts.push(value);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    (callback) => ((scheduled = callback), 1),
    () => {},
    180,
    () => {},
    () => {
      savedSignals += 1;
    },
  );

  saver.schedule({value: 1});
  scheduled?.();
  await Promise.resolve();
  saver.schedule({value: 2});
  saver.flushForLifecycle();

  assert.deepEqual(attempts, [{value: 1}, {value: 2}]);
  assert.equal(saver.hasPending(), true);

  resolvers[1]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saver.hasPending(), false);
  assert.equal(savedSignals, 1);

  resolvers[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saver.hasPending(), true);
  assert.equal(savedSignals, 1, 'stale completion must not be treated as the latest save');
  assert.deepEqual(attempts, [{value: 1}, {value: 2}, {value: 2}]);

  resolvers[2]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saver.hasPending(), false);
  assert.equal(savedSignals, 2);
});

test('App keeps autosave disabled after uncertain settings load and exposes bounded retry UI', async () => {
  const source = (await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(source, /storageService\.loadSettings\(\)/);
  assert.match(source, /status === 'read_failed'/);
  assert.match(source, /settingsReady/);
  assert.match(source, /onRetryPersistence/);
  assert.match(source, /role="alert"/);
});
