/**
 * IndexedDB ストレージ & JSON/バイナリ入出力シリアライザ
 */

import { LayoutPreset, TuningPreset, AppSettings } from '../types/keyboard';
import { ALL_STANDARD_LAYOUTS, ALL_STANDARD_TUNINGS } from './presets';

const DB_NAME = 'MultiMicrotonalKeyboardDB';
const DB_VERSION = 1;

const STORE_LAYOUTS = 'layoutPresets';
const STORE_TUNINGS = 'tuningPresets';
const STORE_SETTINGS = 'appSettings';

// 初期アプリケーション設定
export const DEFAULT_APP_SETTINGS: AppSettings = {
  soundSource: 'piano',
  masterVolume: 0.8,
  noteDecayMs: 0,
  pianoSampleOverrides: undefined,
  sustainLatch: false,
  keyWidth: 60,
  upperKeyWidth: 60,
  lowerKeyWidth: 60,
  visibleKeysCount: 8,
  upperScrollOffset: 0,
  lowerScrollOffset: 0,
  showTwoRows: false,
  showInvalidSections: false,
  autoMappingDirection: 'lowToHigh',
  blackKeyHeightRatio: 0.6,
  blackKeyWidthRatio: 0.65,
  pcDepthOffset: 0,
  upperOctaveOffset: 1,
  lowerOctaveOffset: 0,
  pitchLabelMode: 'note',
};

class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_LAYOUTS)) {
          db.createObjectStore(STORE_LAYOUTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TUNINGS)) {
          db.createObjectStore(STORE_TUNINGS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // --- 配置プリセット操作 ---
  public async getAllLayoutPresets(): Promise<LayoutPreset[]> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(STORE_LAYOUTS, 'readonly');
      const store = tx.objectStore(STORE_LAYOUTS);
      const req = store.getAll();
      return new Promise((resolve) => {
        req.onsuccess = () => {
          const userPresets: LayoutPreset[] = req.result || [];
          // 標準プリセットとユーザー保存プリセットを統合
          const standardIds = new Set(ALL_STANDARD_LAYOUTS.map((s) => s.id));
          const filteredUser = userPresets.filter((u) => !standardIds.has(u.id));
          resolve([...ALL_STANDARD_LAYOUTS, ...filteredUser]);
        };
        req.onerror = () => resolve(ALL_STANDARD_LAYOUTS);
      });
    } catch {
      return ALL_STANDARD_LAYOUTS;
    }
  }

  public async saveLayoutPreset(preset: LayoutPreset): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    const store = tx.objectStore(STORE_LAYOUTS);
    store.put(preset);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- 音高プリセット操作 ---
  public async getAllTuningPresets(): Promise<TuningPreset[]> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(STORE_TUNINGS, 'readonly');
      const store = tx.objectStore(STORE_TUNINGS);
      const req = store.getAll();
      return new Promise((resolve) => {
        req.onsuccess = () => {
          const userPresets: TuningPreset[] = req.result || [];
          const standardIds = new Set(ALL_STANDARD_TUNINGS.map((s) => s.id));
          const filteredUser = userPresets.filter((u) => !standardIds.has(u.id));
          resolve([...ALL_STANDARD_TUNINGS, ...filteredUser]);
        };
        req.onerror = () => resolve(ALL_STANDARD_TUNINGS);
      });
    } catch {
      return ALL_STANDARD_TUNINGS;
    }
  }

  public async saveTuningPreset(preset: TuningPreset): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_TUNINGS, 'readwrite');
    const store = tx.objectStore(STORE_TUNINGS);
    store.put(preset);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteLayoutPreset(id: string): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    const store = tx.objectStore(STORE_LAYOUTS);
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async deleteTuningPreset(id: string): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_TUNINGS, 'readwrite');
    const store = tx.objectStore(STORE_TUNINGS);
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- 設定操作 ---
  public async getSettings(): Promise<AppSettings> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const store = tx.objectStore(STORE_SETTINGS);
      const req = store.get('current_settings');
      return new Promise((resolve) => {
        req.onsuccess = () => {
          if (req.result && req.result.value) {
            resolve({ ...DEFAULT_APP_SETTINGS, ...req.result.value });
          } else {
            resolve(DEFAULT_APP_SETTINGS);
          }
        };
        req.onerror = () => resolve(DEFAULT_APP_SETTINGS);
      });
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  }

  public async saveSettings(settings: AppSettings): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);
    store.put({ key: 'current_settings', value: settings });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- エクスポート/インポート ユーティリティ ---
  /**
   * JSONファイルとしてダウンロード
   */
  public exportAsJson(data: unknown, filename: string) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 圧縮バイナリ形式 (JSON文字列のUTF-8 Byte + Base64化) でダウンロード
   */
  public exportAsBinaryPackage(data: unknown, filename: string) {
    const jsonStr = JSON.stringify(data);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonStr);
    
    // Base64またはArrayBuffer直接保存
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.bin') ? filename : `${filename}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * JSONまたはバイナリファイルを読み込み
   */
  public async importFromFile(file: File): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (file.name.endsWith('.bin')) {
        reader.readAsArrayBuffer(file);
        reader.onload = () => {
          try {
            const decoder = new TextDecoder('utf-8');
            const jsonStr = decoder.decode(reader.result as ArrayBuffer);
            resolve(JSON.parse(jsonStr));
          } catch (e) {
            reject(new Error('バイナリデータの解読に失敗しました。'));
          }
        };
      } else {
        reader.readAsText(file);
        reader.onload = () => {
          try {
            resolve(JSON.parse(reader.result as string));
          } catch (e) {
            reject(new Error('JSONの解析に失敗しました。'));
          }
        };
      }
      reader.onerror = () => reject(reader.error);
    });
  }
  /**
   * プリセットの完全ディープクローン (参照切断)
   */
  public deepClone<T>(obj: T): T {
    if (typeof structuredClone === 'function') {
      return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 配置プリセットの構造整合性検証
   */
  public validateLayoutPreset(data: any): data is LayoutPreset {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.id !== 'string' || typeof data.name !== 'string') return false;
    if (!Array.isArray(data.lanes) || data.lanes.length !== 32) return false;
    if (!Array.isArray(data.mapping) || data.mapping.length !== 256) return false;
    return true;
  }

  /**
   * 音高プリセットの構造整合性検証
   */
  public validateTuningPreset(data: any): data is TuningPreset {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.id !== 'string' || typeof data.name !== 'string') return false;
    if (!Array.isArray(data.pitches)) return false;
    return true;
  }
}

export const storageService = new StorageService();
